import Fastify from "fastify";
import { localOrigins } from "./config.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { readRemoteJson, readRemoteText, readRemoteResponse, SourceError } from "./remote.js";
import { resolve } from "node:path";
import { createQuarkAccountStore } from "./cloud/account-store.js";
import { createQuarkAuth } from "./cloud/quark-auth.js";
import { createQuarkPlayback } from "./cloud/quark-playback.js";
import { livePlaylists, parseM3u, subscriptionLiveEntries } from "./live.js";
import {
  cmsUrl,
  cmsCategoriesUrl,
  parseCategories,
  parseCms,
  parseCmsPage,
  parseSubscription,
} from "./sources.js";
import { builtins, publicBuiltins } from "./builtins.js";
import { registerMetadata } from "./metadata.js";
import { nativeAdapters } from "./adapters/index.js";
import { createMediaProxy } from "./media-proxy.js";

/** 服务端保留有界订阅快照，本地配置由浏览器管理。 */
export function createApp({
  readJson = readRemoteJson,
  readText = readRemoteText,
  readResponse = readRemoteResponse,
  dataDir = process.env.TVBOX_DATA_DIR || resolve(".tvbox-data"),
  logger = true,
  allowedOrigins = localOrigins(),
} = {}) {
  const app = Fastify({
    logger,
    bodyLimit: 4096,
    requestTimeout: 20000,
    routerOptions: { maxParamLength: 400 },
  });
  const sessions = new Map();
  const mediaProxy = createMediaProxy();
  const quark = createQuarkAuth({ store: createQuarkAccountStore(dataDir), readJson, readResponse, revoke: mediaProxy.revoke });
  const cloud = createQuarkPlayback({ auth: quark, readJson, revoke: mediaProxy.revoke });
  const sourceIo = { json: readJson, text: readText, cloud };
  // 与 Node 服务共用生命周期；只处理记录中的、超过活动期的应用临时文件。
  const cleanup = setInterval(async () => {
    try { if ((await quark.status()).state === "logged_in") await cloud.cleanup(); }
    catch (error) { app.log.warn({ message: error instanceof SourceError ? error.message : "临时文件清理失败" }, "夸克临时文件未完成清理"); }
  }, 15 * 60_000);
  cleanup.unref();
  app.addHook("onClose", async () => { clearInterval(cleanup); quark.close(); await mediaProxy.close(); });
  const origins = new Set(allowedOrigins);
  const hosts = new Set(allowedOrigins.map((origin) => new URL(origin).host));
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    reply.header("Cache-Control", "no-store");
    // video 与 HLS 子请求不携带自定义页面头；媒体只能通过服务器登记的能力令牌访问。
    if (req.url.startsWith("/api/media/")) {
      if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin)))
        return reply.code(403).send({ error: "不允许来自此页面的媒体请求。" });
      return;
    }
    if (
      !hosts.has(req.headers.host) ||
      req.headers["x-tvbox-client"] !== "web-v1"
    ) {
      return reply.code(403).send({ error: "请从已配置的观影页面发起请求。" });
    }
    if (req.headers.origin && !origins.has(req.headers.origin)) {
      return reply.code(403).send({ error: "不允许来自此页面的请求。" });
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof SourceError)
      return reply.code(error.statusCode).send({ error: error.message });
    req.log.error(error);
    reply.code(error.statusCode === 413 ? 413 : 500).send({
      error:
        error.statusCode === 413
          ? "请求内容过大。"
          : "服务处理失败，请查看后端日志。",
    });
  });
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/cloud/quark", async () => ({ ...await quark.status(), ...await cloud.status() }));
  app.post("/api/cloud/quark/qr", async () => quark.start());
  app.get("/api/cloud/quark/qr/:id", async (req) => quark.poll(req.params.id));
  app.delete("/api/cloud/quark/qr/:id", async (req) => { quark.cancel(req.params.id); return { ok: true }; });
  app.post("/api/cloud/quark/cleanup", async () => cloud.cleanup());
  app.delete("/api/cloud/quark", async () => cloud.logout());
  app.get("/api/media/:token", mediaProxy.serve);
  registerMetadata(app, readJson);
  app.get("/api/builtins", async () => ({ subscriptions: publicBuiltins() }));
  app.get("/api/live/playlists", async () => ({
    playlists: livePlaylists.map(({ config, url, ...item }) => item),
  }));
  app.post("/api/live/playlists", async (req) => {
    const input = z
      .union([
        z.object({ builtinId: z.string() }),
        z.object({ url: z.string().url().max(2048) }),
        z.object({ subscriptionId: z.string(), playlistId: z.string() }),
      ])
      .safeParse(req.body);
    if (!input.success)
      throw new SourceError("请选择直播片库或输入完整 M3U 地址。", 400);
    let playlist;
    if ("builtinId" in input.data) {
      playlist = livePlaylists.find((item) => item.id === input.data.builtinId);
      if (!playlist) throw new SourceError("没有找到这个直播片库。", 404);
    } else if ("subscriptionId" in input.data) {
      const session = sessions.get(input.data.subscriptionId);
      if (!session || session.expires < Date.now())
        throw new SourceError("订阅会话已过期，请重新读取片库。", 410);
      playlist = session.livePlaylists.find(
        (item) => item.id === input.data.playlistId,
      );
      if (!playlist) throw new SourceError("订阅中没有这个直播入口。", 404);
      if (!playlist.supported) throw new SourceError(playlist.reason);
    } else playlist = { name: "自定义直播", url: input.data.url };
    const text = playlist.config ?? (await readText(playlist.url));
    return {
      name: playlist.name,
      fetchedAt: new Date().toISOString(),
      channels: parseM3u(text, playlist.url),
    };
  });
  app.post("/api/subscriptions", async (req, reply) => {
    const input = z
      .union([
        z.object({ url: z.string().url().max(2048) }),
        z.object({ builtinId: z.string() }),
      ])
      .safeParse(req.body);
    if (!input.success) throw new SourceError("请输入有效的订阅 URL。", 400);
    let config;
    let name = "自定义片库";
    if ("builtinId" in input.data) {
      const builtin = builtins.find((item) => item.id === input.data.builtinId);
      if (!builtin) throw new SourceError("没有找到这个内置片库。", 404);
      config =
        builtin.config ?? (await readJson(builtin.url, { subscription: true }));
      name = builtin.name;
    } else config = await readJson(input.data.url, { subscription: true });
    const sites = parseSubscription(config);
    const liveEntries = subscriptionLiveEntries(config);
    // 配置指纹跨服务重启保持稳定，浏览历史不依赖会过期的会话编号。
    const revision = createHash("sha256")
      .update(JSON.stringify({ sites, liveEntries }))
      .digest("hex");
    const now = Date.now();
    for (const [key, value] of sessions)
      if (value.expires < now) sessions.delete(key);
    const sourceKey =
      "builtinId" in input.data
        ? `builtin:${input.data.builtinId}`
        : input.data.url;
    // 同一内容复用会话；配置变化建立新快照，旧请求不会改写当前会话里的站点。
    const existing = [...sessions.entries()].find(
      ([, value]) =>
        value.sourceKey === sourceKey && value.revision === revision,
    );
    if (!existing && sessions.size >= 64)
      throw new SourceError("本机会话已满，请重启服务后重新导入。", 429);
    const id = existing?.[0] ?? randomUUID();
    sessions.set(id, {
      sites,
      livePlaylists: liveEntries,
      revision,
      sourceKey,
      expires: now + 60 * 60 * 1000,
    });
    return reply.send({
      id,
      revision,
      name,
      fetchedAt: new Date(now).toISOString(),
      livePlaylists: liveEntries.map(({ url, ...item }) => item),
      sites: sites.map(({ key, name, supported, reason, searchable }) => ({
        key,
        name,
        supported,
        // TVBox searchable 为 0 时禁用；缺省 1，与原配置解析规则一致。
        searchable: supported && searchable !== 0,
        reason,
      })),
    });
  });

  app.delete("/api/subscriptions", async (req) => {
    const input = z
      .object({ url: z.string().url().max(2048) })
      .safeParse(req.body);
    if (!input.success)
      throw new SourceError("请输入要移除的自定义订阅地址。", 400);
    // 只释放本机的来源快照，不向第三方订阅发出删除请求。
    for (const [id, session] of sessions)
      if (session.sourceKey === input.data.url) sessions.delete(id);
    return { ok: true };
  });

  function siteFor(params) {
    const session = sessions.get(params.subscription);
    if (!session || session.expires < Date.now()) {
      if (session) sessions.delete(params.subscription);
      throw new SourceError("订阅会话已过期，请重新读取订阅。", 410);
    }
    const site = session.sites.find(({ key }) => key === params.site);
    if (!site) throw new SourceError("订阅中不存在这个站点。", 404);
    if (!site.supported) throw new SourceError(site.reason);
    return site;
  }
  app.get(
    "/api/subscriptions/:subscription/sites/:site/categories",
    async (req) => {
      const site = siteFor(req.params);
      return {
        categories: nativeAdapters[site.adapter] ? await nativeAdapters[site.adapter].categories(site, sourceIo)
          : parseCategories(await readJson(cmsCategoriesUrl(site.requestApi ?? site.api))),
      };
    },
  );
  app.get(
    "/api/subscriptions/:subscription/sites/:site/videos",
    async (req, reply) => {
      const site = siteFor(req.params);
      const search = z
        .object({
          search: z.string().trim().max(100).optional(),
          page: z.coerce.number().int().min(1).max(100000).default(1),
          category: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,100}$/)
            .optional(),
        })
        .safeParse(req.query);
      if (!search.success)
        throw new SourceError(
          "搜索词最多 100 字，分类编号须有效，页码须为 1–100000 的整数。",
          400,
        );
      if (search.data.search && site.searchable === 0)
        throw new SourceError(
          "这个来源已关闭搜索，可以浏览分类或选择其他来源。",
          422,
        );
      const controller = new AbortController();
      const cancel = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.once("close", cancel);
      try {
        return parseCmsPage(
          nativeAdapters[site.adapter] ? await nativeAdapters[site.adapter].page(site, search.data, sourceIo, { signal: controller.signal }) : await readJson(
            cmsUrl(site.requestApi ?? site.api, undefined, search.data.search, {
              page: search.data.page,
              category: search.data.category,
            }),
            { signal: controller.signal },
          ),
        );
      } finally {
        reply.raw.removeListener("close", cancel);
      }
    },
  );
  app.get(
    "/api/subscriptions/:subscription/sites/:site/videos/:film",
    async (req) => {
      const site = siteFor(req.params);
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(req.params.film))
        throw new SourceError("影片编号不符合支持格式。", 400);
      const films = parseCms(
        nativeAdapters[site.adapter] ? await nativeAdapters[site.adapter].detail(site, req.params.film, sourceIo)
          : await readJson(cmsUrl(site.requestApi ?? site.api, req.params.film)),
        true,
        !!nativeAdapters[site.adapter],
      );
      const film = films.find(({ id }) => id === req.params.film);
      if (!film) throw new SourceError("源中已找不到这部影片。", 404);
      if (nativeAdapters[site.adapter]) {
        for (const line of film.lines) for (const episode of line.episodes) {
          Object.assign(episode, nativeAdapters[site.adapter].publicEpisode?.(episode));
          const reference = nativeAdapters[site.adapter].selectionRef?.(episode.playbackId);
          delete episode.playbackId;
          episode.url = `/api/subscriptions/${encodeURIComponent(req.params.subscription)}/sites/${encodeURIComponent(req.params.site)}/videos/${encodeURIComponent(req.params.film)}/play`;
          if (reference) episode.url += `?ref=${reference}`;
          episode.mime = "application/x-tvbox-resolve";
        }
      } else if (site.adapter === "cms") {
        for (const line of film.lines) for (const episode of line.episodes)
          if (episode.url && episode.mime) episode.url = mediaProxy.register(episode.url, {}, { manifest: episode.mime === "application/x-mpegURL" });
      }
      return { film };
    },
  );
  app.post("/api/subscriptions/:subscription/sites/:site/videos/:film/play", async (req, reply) => {
    const site = siteFor(req.params);
    const adapter = nativeAdapters[site.adapter];
    if (!adapter?.play) throw new SourceError("此站点无需独立解析。", 400);
    const input = z.object({ line: z.number().int().min(0), episode: z.number().int().min(0) }).safeParse(req.body);
    if (!input.success || !/^[a-zA-Z0-9_-]{1,100}$/.test(req.params.film)) throw new SourceError("播放选择无效。", 400);
    const controller = new AbortController();
    const cancel = () => { if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", cancel);
    try {
      const options = { signal: controller.signal };
      const films = parseCms(await adapter.detail(site, req.params.film, sourceIo, options), true, true);
      const selected = films.find(({ id }) => id === req.params.film)?.lines[input.data.line]?.episodes[input.data.episode];
      if (!selected?.playbackId) throw new SourceError("此集已不存在，请重新读取详情。", 404);
      if (adapter.selectionRef && req.query.ref !== adapter.selectionRef(selected.playbackId))
        throw new SourceError("分享目录已变化，请刷新影片后重新选择，避免播放到其他文件。", 409);
      const media = await adapter.play(site, selected.playbackId, sourceIo, options);
      const path = new URL(media.url).pathname.toLowerCase();
      const mp4 = path.endsWith(".mp4");
      return { url: mediaProxy.register(media.url, media.headers, { allowedOrigins: media.allowedOrigins, manifest: !mp4, owner: media.owner, onUse: media.onUse, isActive: media.isActive }), mime: mp4 ? "video/mp4" : "application/x-mpegURL" };
    } finally {
      reply.raw.removeListener("close", cancel);
    }
  });
  return app;
}
