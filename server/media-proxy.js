import { createHash, randomUUID } from "node:crypto";
import { request } from "undici";
import { SourceError, validateRemoteUrl, createRemoteDispatcher } from "./remote.js";

/** 只转发服务器已登记的播放资源；调用方不能用请求参数指定任意目标地址。 */
export function createMediaProxy({ dispatcher = createRemoteDispatcher() } = {}) {
  const resources = new Map();
  const identities = new Map();
  const active = new Set();
  let cleanupAfter = 0;
  function prune(now) {
    // 一集 HLS 可有数千分片，登记时不能逐片扫描整张表。
    if (now < cleanupAfter && resources.size < 50_000) return;
    for (const [key, item] of resources) if (item.lease.expires <= now) { resources.delete(key); identities.delete(item.identity); }
    cleanupAfter = now + 60_000;
  }
  function validate(address, allowedOrigins) {
    const target = new URL(address);
    return validateRemoteUrl(address, { allowedPorts: allowedOrigins.includes(target.origin) ? [target.port] : [] });
  }
  function register(address, headers = {}, { allowedOrigins = [], lease, manifest = false, owner = "", onUse, isActive, credentialOrigins } = {}) {
    if (isActive && !isActive()) throw new SourceError("网盘播放授权已撤销，请重新登录。", 401);
    const url = validate(address, allowedOrigins).href;
    credentialOrigins ??= [new URL(url).origin];
    const now = Date.now();
    prune(now);
    const identity = createHash("sha256").update(JSON.stringify([url, headers, allowedOrigins, lease?.id ?? "root", manifest, owner, credentialOrigins])).digest("hex");
    const existing = identities.get(identity);
    if (existing && resources.get(existing)?.lease.expires > now) {
      resources.get(existing).lease.expires = now + 60 * 60 * 1000;
      return `/api/media/${existing}`;
    }
    // 实播中两集清单就可能超过 5000 项；保留家庭并发空间，仍设置总量上限。
    if (resources.size >= 50_000) throw new SourceError("播放资源过多，请稍后重试。", 429);
    const id = randomUUID();
    // 同一播放清单的分片共用活动期，避免长电影后段因最初登记超过一小时而失效。
    const activity = lease ?? { id, expires: now + 60 * 60 * 1000 };
    resources.set(id, { url, headers, allowedOrigins, identity, lease: activity, manifest, owner, onUse, isActive, credentialOrigins });
    identities.set(identity, id);
    return `/api/media/${id}`;
  }
  function rewrite(text, base, headers, allowedOrigins = [], lease, ownership = {}) {
    const link = (value, manifest = false) => register(new URL(value, base).href, headers, { ...ownership, allowedOrigins, lease, manifest });
    let nextManifest = false;
    return text.split(/\r?\n/).map((line) => {
      if (line.startsWith("#")) {
        if (line.startsWith("#EXT-X-STREAM-INF:")) nextManifest = true;
        return line.replace(/URI="([^"]+)"/g, (_match, value) => `URI="${link(value, /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/.test(line))}"`);
      }
      if (!line.trim()) return line;
      const path = link(line.trim(), nextManifest);
      nextManifest = false;
      return path;
    }).join("\n");
  }
  async function serve(req, reply) {
    const saved = resources.get(req.params.token);
    if (!saved || saved.lease.expires <= Date.now()) throw new SourceError("播放地址已过期，请重新打开影片。", 410);
    if (saved.isActive && !saved.isActive()) throw new SourceError("网盘播放授权已撤销，请重新登录。", 401);
    saved.lease.expires = Date.now() + 60 * 60 * 1000;
    saved.onUse?.();
    const controller = new AbortController();
    const entry = { controller, owner: saved.owner };
    active.add(entry);
    const cancel = () => { active.delete(entry); if (!reply.raw.writableEnded) controller.abort(); };
    reply.raw.once("close", cancel);
    let response;
    try {
      let target = validate(saved.url, saved.allowedOrigins);
      for (let redirect = 0; redirect <= 3; redirect++) {
        response = await request(target, {
          method: req.method, dispatcher, signal: controller.signal,
          headersTimeout: 15_000, bodyTimeout: 15_000, maxRedirections: 0,
          // 账号凭据只允许发送到最初登记的精确来源，跨域清单及重定向不能继承 Cookie。
          headers: { "user-agent": "TVBox-Web/0.1", accept: "*/*", ...Object.fromEntries(Object.entries(saved.headers).filter(([name]) =>
            !/^(cookie|authorization|proxy-authorization)$/i.test(name) || saved.credentialOrigins.includes(target.origin))),
            "accept-encoding": "identity", ...(req.headers.range ? { range: req.headers.range } : {}) },
        });
        if (![301, 302, 303, 307, 308].includes(response.statusCode)) break;
        response.body.on("error", () => {}); response.body.destroy();
        if (redirect === 3 || !response.headers.location) throw new SourceError("媒体重定向无效。", 502);
        target = validate(new URL(response.headers.location, target).href, saved.allowedOrigins);
      }
      if (![200, 206, 416].includes(response.statusCode)) {
        response.body.on("error", () => {}); response.body.destroy();
        throw new SourceError(`媒体返回 HTTP ${response.statusCode}。`, 502);
      }
      reply.code(response.statusCode);
      const type = String(response.headers["content-type"] ?? "application/octet-stream");
      const manifest = response.statusCode === 200 && (saved.manifest || /mpegurl/i.test(type) || target.pathname.toLowerCase().endsWith(".m3u8"));
      reply.header("content-type", manifest ? "application/vnd.apple.mpegurl" : type);
      for (const name of ["content-range", "accept-ranges"]) if (response.headers[name]) reply.header(name, response.headers[name]);
      if (manifest && req.method !== "HEAD") {
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 1024 * 1024) { response.body.destroy(); throw new SourceError("媒体清单超过读取上限。", 502); }
          chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
        if (!text.trimStart().startsWith("#EXTM3U")) throw new SourceError("线路未返回有效 HLS 清单。", 502);
        return reply.send(rewrite(text, target, saved.headers, saved.allowedOrigins, saved.lease,
          { owner: saved.owner, onUse: saved.onUse, isActive: saved.isActive, credentialOrigins: saved.credentialOrigins }));
      }
      if (response.headers["content-length"]) reply.header("content-length", response.headers["content-length"]);
      return reply.send(response.body);
    } catch (error) {
      if (response?.body && !response.body.destroyed) { response.body.on("error", () => {}); response.body.destroy(); }
      if (controller.signal.aborted) { active.delete(entry); if (!reply.raw.destroyed) reply.raw.destroy(); return; }
      if (error instanceof SourceError) throw error;
      throw new SourceError(`媒体连接失败：${error.code ?? error.message}`, 502);
    }
  }
  function revoke(prefix) {
    for (const [id, item] of resources) if (item.owner.startsWith(prefix)) { resources.delete(id); identities.delete(item.identity); }
    for (const entry of active) if (entry.owner.startsWith(prefix)) { entry.controller.abort(); active.delete(entry); }
  }
  return { register, serve, rewrite, revoke, close() { revoke(""); resources.clear(); identities.clear(); return dispatcher.destroy(); } };
}
