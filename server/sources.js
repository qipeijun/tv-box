import { z } from "zod";
import { SourceError, validateRemoteUrl } from "./remote.js";
import { nativeSite } from "./adapters/fantaiying.js";

const configSchema = z.object({
  sites: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        type: z.number().int(),
        api: z.string(),
        jar: z.string().optional(),
        ext: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
        searchable: z
          .union([
            z.number().int(),
            z
              .string()
              .regex(/^-?\d+$/)
              .transform(Number),
          ])
          .refine(Number.isSafeInteger)
          .optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export function parseSubscription(data) {
  // MoonTV 的公开配置以 api_site 存放标准 CMS 入口；只在这一已核实边界转换。
  if (!data?.sites && data?.api_site) {
    const moon = z
      .object({
        api_site: z.record(
          z.string(),
          z.object({ name: z.string().min(1), api: z.string() }),
        ),
      })
      .safeParse(data);
    if (!moon.success)
      throw new SourceError("订阅的 api_site 结构不符合支持格式。");
    data = {
      sites: Object.entries(moon.data.api_site).map(([key, site]) => ({
        key,
        ...site,
        type: 1,
      })),
    };
  }
  const parsed = configSchema.safeParse(data);
  if (!parsed.success)
    throw new SourceError("订阅不符合 TVBox JSON 的 sites 结构，请检查配置。");
  const keys = new Set();
  return parsed.data.sites.map((site) => {
    if (keys.has(site.key))
      throw new SourceError("订阅存在重复的站点 key，无法可靠区分站点。");
    keys.add(site.key);
    let reason = "";
    let native;
    try { native = nativeSite(site); } catch (error) { reason = error.message; }
    if (native) return { ...site, ...native, supported: true, reason: "" };
    if (site.type !== 1 || site.jar)
      reason ||= "此 Spider 尚无 Node 适配，不执行原始 Android JAR。";
    else {
      try {
        validateRemoteUrl(site.api);
      } catch (error) {
        reason = error.message;
      }
    }
    return { ...site, supported: !reason, reason };
  });
}

const id = z.union([z.string().min(1), z.number().int()]).transform(String);
const filmSchema = z.object({
  vod_id: id,
  vod_name: z.string(),
  vod_pic: z.string().optional(),
  vod_remarks: z.string().optional(),
  vod_year: z.union([z.string(), z.number()]).optional(),
  type_name: z.string().optional(),
  vod_content: z.string().optional(),
  vod_play_from: z.string().optional(),
  vod_play_url: z.string().optional(),
  vod_actor: z.string().optional(),
  vod_director: z.string().optional(),
  vod_area: z.string().optional(),
  vod_lang: z.string().optional(),
});
const cmsSchema = z.object({ code: z.literal(1), list: z.array(filmSchema) });

function webUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function parseLines(from = "", play = "", resolvePlayback = false) {
  if (!from || !play) return [];
  const names = from.split("$$$");
  const groups = play.split("$$$");
  if (names.length !== groups.length)
    throw new SourceError("影片的线路与播放列表数量不一致。");
  return groups.map((group, lineIndex) => ({
    name: names[lineIndex],
    episodes: group
      .split("#")
      .filter(Boolean)
      .map((item, index) => {
        const delimiter = item.indexOf("$");
        if (delimiter < 1)
          throw new SourceError("影片的集数格式不符合“集名$地址”。");
        const name = item.slice(0, delimiter);
        const url = webUrl(item.slice(delimiter + 1));
        const playbackId = resolvePlayback ? item.slice(delimiter + 1) : undefined;
        // 分享页或外部解析页不能当成媒体直链交给播放器，也不执行订阅里的解析脚本。
        const extension = url ? new URL(url).pathname.toLowerCase() : "";
        const mime = extension.endsWith(".m3u8")
          ? "application/x-mpegURL"
          : extension.endsWith(".mp4")
            ? "video/mp4"
            : null;
        return {
          id: `${lineIndex}:${index}`,
          name,
          url,
          mime,
          ...(resolvePlayback ? { playbackId, needsResolve: true } : {}),
          reason: mime || resolvePlayback
            ? ""
            : "此入口不是已识别的 HLS/MP4 直链，首版不调用外部解析服务。",
        };
      }),
  }));
}

export function parseCms(data, details = false, resolvePlayback = false) {
  const result = cmsSchema.safeParse(data);
  if (!result.success)
    throw new SourceError(
      "站点未返回已支持的 CMS JSON 数据（code: 1 与 list）。",
    );
  return result.data.list.map((film) => ({
    id: film.vod_id,
    name: film.vod_name,
    poster: webUrl(film.vod_pic),
    remarks: film.vod_remarks || "",
    year: film.vod_year === undefined ? "" : String(film.vod_year),
    category: film.type_name || "",
    // 外部简介作为纯文本展示，不把源 HTML 注入页面。
    description: (film.vod_content || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .trim(),
    ...(details
      ? {
          lines: parseLines(film.vod_play_from, film.vod_play_url, resolvePlayback),
          actors: film.vod_actor,
          director: film.vod_director,
          area: film.vod_area,
          language: film.vod_lang,
        }
      : {}),
  }));
}

const count = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform(Number)
  .refine(Number.isSafeInteger);

/** 标准 CMS 的 class 字段；未提供分类时返回空列表，不从影片名称推造分类。 */
export function parseCategories(data) {
  const parsed = z
    .object({
      code: z.literal(1),
      class: z
        .array(
          z.object({
            type_id: id,
            type_name: z.string().min(1),
            type_pid: id.optional(),
          }),
        )
        .optional(),
    })
    .safeParse(data);
  if (!parsed.success)
    throw new SourceError("来源没有返回有效的 CMS 分类数据。");
  const categories = (parsed.data.class ?? []).map((item) => ({
    id: item.type_id,
    name: item.type_name,
    parentId: item.type_pid,
  }));
  if (new Set(categories.map((item) => item.id)).size !== categories.length)
    throw new SourceError("来源分类编号重复，无法可靠选择分类。");
  return categories;
}

export function parseCmsPage(data) {
  const films = parseCms(data);
  const parsed = z
    .object({
      page: count.optional(),
      pagecount: count.optional(),
      total: count.optional(),
    })
    .safeParse(data);
  if (!parsed.success)
    throw new SourceError("来源返回的分页信息不符合支持格式。");
  const { page, pagecount, total } = parsed.data;
  if (page === 0) throw new SourceError("来源返回的页码无效。");
  return {
    films,
    pagination:
      page === undefined || pagecount === undefined
        ? null
        : { page, pages: pagecount, ...(total === undefined ? {} : { total }) },
  };
}

export function cmsCategoriesUrl(api) {
  const url = validateRemoteUrl(api);
  url.searchParams.set("ac", "list");
  for (const name of ["ids", "wd", "pg", "t"]) url.searchParams.delete(name);
  return url.href;
}

export function cmsUrl(api, filmId, search, options) {
  const url = validateRemoteUrl(api);
  url.searchParams.set("ac", "detail");
  if (filmId !== undefined) url.searchParams.set("ids", filmId);
  if (search) url.searchParams.set("wd", search);
  if (options) {
    url.searchParams.delete("ids");
    if (!search) url.searchParams.delete("wd");
    url.searchParams.set("pg", String(options.page));
    if (options.category) url.searchParams.set("t", options.category);
    else url.searchParams.delete("t");
  }
  return url.href;
}
