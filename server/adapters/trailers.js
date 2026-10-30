import { load } from "cheerio";
import { SourceError, validateRemoteUrl } from "../remote.js";

// YGPGuard 的固定参考指向 6huo 预告片；当前页面已改为 /movie 和 /allmovies 路径。
const ORIGIN = "https://www.6huo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const headers = { "user-agent": UA, referer: `${ORIGIN}/` };
const textOf = (element) => element.text().replace(/\s+/g, " ").trim();
const absolute = (value) => value ? new URL(value, ORIGIN).href : "";

async function html(path, io, options) {
  const text = await io.text(new URL(path, ORIGIN).href, { ...options, headers });
  const $ = load(text);
  if (!$("div.movlist,h1.movie-name").length) throw new SourceError("荐影未返回已核实的预告片页面。", 502);
  return $;
}
function cards($) {
  const selector = $("div.inner-2col-main div.movlist > ul li > a").length ? "div.inner-2col-main div.movlist > ul li > a" : "div.movlist > ul li > a";
  const list = [], seen = new Set();
  $(selector).each((_, element) => {
    const a = $(element), id = a.attr("href")?.match(/^\/movie\/(\d+)$/)?.[1];
    const name = a.find("span").first().attr("title")?.trim();
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    list.push({ vod_id: id, vod_name: name, vod_pic: absolute(a.find("img").first().attr("src")), type_name: "电影预告片", vod_remarks: "预告片" });
  });
  return list;
}
export const trailerAdapter = {
  async categories(_site, io) {
    await html("/allmovies", io);
    return [{ id: "allmovies", name: "电影预告片" }, { id: "nowplaying", name: "正在热映" }];
  },
  async page(_site, query, io, options) {
    if (query.category && !["allmovies", "nowplaying"].includes(query.category)) throw new SourceError("荐影分类无效。", 400);
    if (query.category === "nowplaying" && query.page !== 1) throw new SourceError("荐影当前档期页面没有分页。", 400);
    const path = query.search ? `/?view=search&keyword=${encodeURIComponent(query.search)}&page=${query.page}`
      : query.category === "nowplaying" ? "/nowplaying" : query.page > 1 ? `/allmovies/${query.page}` : "/allmovies";
    const $ = await html(path, io, options), list = cards($);
    const pages = $(".page-nav a").map((_, a) => Number(textOf($(a)))).get().filter((v) => Number.isInteger(v) && v > 0);
    return { code: 1, list, ...(pages.length ? { page: query.page, pagecount: Math.max(query.page, ...pages) } : query.category === "nowplaying" ? { page: 1, pagecount: 1, total: list.length } : {}) };
  },
  async detail(_site, id, io, options) {
    if (!/^\d+$/.test(id)) throw new SourceError("荐影片名编号无效。", 400);
    const $ = await html(`/movie/${id}`, io, options), h1 = $("h1.movie-name").first();
    const name = textOf(h1.clone().children().remove().end());
    if (!name) throw new SourceError("荐影详情缺少影片名称。", 502);
    const episodes = [], seen = new Set();
    $("div#tabwrapper-all tr").each((_, row) => {
      const title = textOf($(row).find("a.tlist-bbs-tdtitle").first());
      const download = $(row).find("a.tlist-btn[href^='/download/']").first().attr("href")?.match(/^\/download\/(\d+)$/)?.[1];
      if (!title || !download || seen.has(download)) return;
      seen.add(download);
      episodes.push(`${title}$${Buffer.from(JSON.stringify({ download })).toString("base64url")}`);
    });
    const info = textOf($("div.movie-title-detail p"));
    return { code: 1, list: [{ vod_id: id, vod_name: name, type_name: "电影预告片", vod_remarks: "预告片",
      vod_pic: absolute($("div.movie-title-mpic > a > img").first().attr("src")),
      vod_year: info.match(/上映[：:]\s*(\d{4})/)?.[1] ?? "",
      vod_content: info.match(/剧情[：:]\s*([\s\S]*?)(?:\(详细\)|$)/)?.[1] ?? "",
      vod_play_from: episodes.length ? "预告片" : "", vod_play_url: episodes.join("#"),
    }] };
  },
  async play(_site, raw, io, options) {
    const { download } = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!/^\d+$/.test(download)) throw new SourceError("荐影预告片标识无效。", 502);
    const data = await io.json(`${ORIGIN}/?view=api&mode=download-data&ttid=${download}`, { ...options, headers });
    if (!Array.isArray(data) || !data[0]?.movurl) throw new SourceError("荐影没有返回可播放的预告片。", 502);
    const url = validateRemoteUrl(data[0].movurl);
    if (!/\.(mp4|m3u8)$/i.test(url.pathname)) throw new SourceError("荐影返回的格式尚未支持网页播放。", 502);
    return { url: url.href, headers };
  },
};
