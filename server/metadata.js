import { z } from "zod";
import { SourceError } from "./remote.js";

const providerSchema = z.enum(["cinemeta", "tvmaze"]);
const imageUrl = (value) => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
};
const text = (value) => typeof value === "string" ? value : "";
const year = (value) => text(value).match(/^\d{4}/)?.[0] ?? "";
const rating = (value) => {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 && number <= 10 ? number : null;
};

function movie(data) {
  if (!data || !/^tt\d+$/.test(data.id ?? "") || data.type !== "movie" || !text(data.name)) return null;
  let poster = imageUrl(data.poster);
  // 已实测 Metahub 的同片大图入口；仅转换这一已确认的路径，不改写其他平台地址。
  if (poster === `https://images.metahub.space/poster/small/${data.id}/img`) poster = `https://images.metahub.space/poster/large/${data.id}/img`;
  return {
    provider: "cinemeta", id: data.id, name: data.name, year: year(data.releaseInfo || data.year),
    poster, background: imageUrl(data.background), warnings: [],
    rating: rating(data.imdbRating), ratingLabel: "IMDb · Cinemeta 提供",
    url: `https://www.imdb.com/title/${data.id}/`, attribution: "资料由 Cinemeta 提供",
    runtime: text(data.runtime), released: text(data.released).slice(0, 10),
    directors: Array.isArray(data.director) ? data.director.filter((x) => typeof x === "string") : [],
    cast: Array.isArray(data.cast) ? data.cast.filter((x) => typeof x === "string").slice(0, 20).map((name) => ({ name, role: "", image: null })) : [],
  };
}

function show(data) {
  if (!data || !Number.isInteger(data.id) || data.id <= 0 || !text(data.name)) return null;
  return {
    provider: "tvmaze", id: String(data.id), name: data.name, year: year(data.premiered),
    poster: imageUrl(data.image?.original), background: null, warnings: [],
    rating: rating(data.rating?.average), ratingLabel: "TVmaze",
    url: `https://www.tvmaze.com/shows/${data.id}`, attribution: "资料由 TVmaze 提供 · CC BY-SA",
    runtime: typeof data.runtime === "number" && data.runtime > 0 ? `${data.runtime} 分钟 / 集` : "",
    released: text(data.premiered), directors: [], cast: [],
  };
}

/** 外部资料仅用于展示；不生成或替换播放线路。地址由平台及 ID 构造，不接受任意远端地址。 */
export function registerMetadata(app, readJson) {
  const cache = new Map();
  const pending = new Map();
  async function read(url) {
    const saved = cache.get(url);
    if (saved && saved.expires > Date.now()) return saved.data;
    if (pending.has(url)) return pending.get(url);
    const request = readJson(url).then((data) => {
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      cache.set(url, { data, expires: Date.now() + 60 * 60 * 1000 });
      return data;
    }).finally(() => pending.delete(url));
    pending.set(url, request);
    return request;
  }
  app.post("/api/metadata/search", async (req) => {
    const parsed = z.object({ provider: providerSchema, query: z.string().trim().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) throw new SourceError("请选择资料平台，片名应为 1–120 个字符。", 400);
    const { provider, query } = parsed.data;
    if (provider === "cinemeta") {
      const data = await read(`https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(query)}.json`);
      if (!Array.isArray(data?.metas)) throw new SourceError("电影资料返回格式无效。", 502);
      return { candidates: data.metas.map(movie).filter(Boolean).slice(0, 12) };
    }
    const data = await read(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
    if (!Array.isArray(data)) throw new SourceError("剧集资料返回格式无效。", 502);
    return { candidates: data.map((item) => show(item?.show)).filter(Boolean).slice(0, 12) };
  });
  app.get("/api/metadata/:provider/:id", async (req) => {
    const parsed = z.object({ provider: providerSchema, id: z.string().max(24) }).safeParse(req.params);
    if (!parsed.success) throw new SourceError("影片资料标识无效。", 400);
    const { provider, id } = parsed.data;
    if (!(provider === "cinemeta" ? /^tt\d+$/.test(id) : /^[1-9]\d*$/.test(id))) throw new SourceError("影片资料标识无效。", 400);
    if (provider === "cinemeta") {
      const data = await read(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`);
      const result = movie(data?.meta);
      if (!result || result.id !== id) throw new SourceError("没有取得对应电影资料。", 502);
      return result;
    }
    const [detail, artwork] = await Promise.allSettled([
      read(`https://api.tvmaze.com/shows/${id}?embed=cast`),
      read(`https://api.tvmaze.com/shows/${id}/images`),
    ]);
    if (detail.status === "rejected") throw detail.reason;
    const data = detail.value;
    const result = show(data);
    if (!result || result.id !== id) throw new SourceError("没有取得对应剧集资料。", 502);
    if (artwork.status === "fulfilled" && Array.isArray(artwork.value)) {
      result.background = imageUrl(artwork.value.find((item) => item?.type === "background")?.resolutions?.original?.url);
    } else {
      const message = artwork.status === "rejected" ? artwork.reason?.message : "图片资料格式无效";
      result.warnings.push(`背景图暂未取得：${message || "图片平台请求失败"}`);
    }
    result.cast = (Array.isArray(data._embedded?.cast) ? data._embedded.cast : []).slice(0, 20).flatMap((item) => text(item?.person?.name) ? [{
      name: item.person.name, role: text(item.character?.name), image: imageUrl(item.person.image?.original),
    }] : []);
    return result;
  });
}
