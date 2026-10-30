import { load } from "cheerio";
import { SourceError, validateRemoteUrl } from "../remote.js";

// 依据固定上游 Wwys/Nmyswv 映射与当前站点页面；只读取数据，不执行页面脚本。
export const NUOMI_ORIGIN = "https://vip.wwgz.cn:5200";
const PARSER_ORIGIN = "https://api.wwgz.cn:520";
const UA = "Mozilla/5.0 (Linux; Android 13; SM-A037U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36 uacq";

function optionsFor(address, site, options = {}) {
  const target = new URL(address);
  const allowedPorts = [NUOMI_ORIGIN, PARSER_ORIGIN].includes(target.origin) ? [target.port] : [];
  validateRemoteUrl(address, { allowedPorts });
  return { ...options, allowedPorts, headers: { "user-agent": UA, referer: `${site.requestApi}/`, accept: "text/html,*/*" } };
}
async function page(site, path, readText, options) {
  const address = new URL(path, `${site.requestApi}/`).href;
  const text = await readText(address, optionsFor(address, site, options));
  if (!text.trim() || text.includes("缺少文件：")) throw new SourceError("糯米页面未返回有效内容，请稍后重试。", 502);
  return text;
}
const clean = (text) => text.replace(/\s+/g, " ").trim();
const absolute = (site, value) => value ? new URL(value, `${site.requestApi}/`).href : "";

/** 读取页面中的字符串字面量，拒绝表达式；不使用 eval 或运行订阅代码。 */
export function scriptString(text, field, jsonKey = false) {
  const key = jsonKey ? `["']${field}["']\\s*:` : `\\b${field}\\s*=`;
  const match = text.match(new RegExp(`${key}\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`));
  if (!match) throw new SourceError(`糯米页面缺少 ${field} 数据。`, 502);
  const literal = match[1];
  try {
    return literal.startsWith('"') ? JSON.parse(literal)
      : JSON.parse('"' + literal.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');
  } catch { throw new SourceError(`糯米 ${field} 字符串格式无效。`, 502); }
}

export function nuomiCards(text, site) {
  const $ = load(text), seen = new Set(), list = [];
  $('a[href*="/vod-detail-id-"][title]').each((_, element) => {
    const a = $(element), id = a.attr("href")?.match(/\/vod-detail-id-(\d+)\.html/)?.[1];
    const name = clean(a.attr("title") ?? "");
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    const img = a.find("img").first();
    list.push({ vod_id: id, vod_name: name,
      vod_pic: absolute(site, img.attr("data-echo") || img.attr("data-src") || img.attr("src")),
      vod_remarks: clean(a.find(".sBottom span").first().clone().children().remove().end().text()),
    });
  });
  return list;
}

export async function nuomiCategories(site, readText, options) {
  const $ = load(await page(site, "/", readText, options)), seen = new Set(), categories = [];
  $("#topnav a[href]").each((_, a) => {
    const id = $(a).attr("href")?.match(/vod-type-id-(\d+)-/)?.[1], name = clean($(a).text());
    if (id && name && !seen.has(id)) { seen.add(id); categories.push({ id, name }); }
  });
  if (!categories.length) throw new SourceError("糯米页面缺少分类，站点结构可能已变化。", 502);
  return categories;
}

export async function nuomiPage(site, query, readText, options) {
  if (query.search) throw new SourceError("糯米当前网站已关闭搜索，请使用分类浏览。");
  if (query.category && !/^\d+$/.test(query.category)) throw new SourceError("糯米分类编号无效。", 400);
  const path = query.category ? `/vod-list-id-${query.category}-pg-${query.page}-order--by-time-class-0-year-0-letter--area--lang-.html` : "/";
  const text = await page(site, path, readText, options), $ = load(text);
  if (!$("#topnav").length) throw new SourceError("糯米列表结构已变化。", 502);
  const list = nuomiCards(text, site), paging = clean($(".page").text());
  const pages = paging.match(/当前\s*[:：]\s*(\d+)\s*\/\s*(\d+)\s*页/);
  const total = paging.match(/共\s*(\d+)\s*条/);
  return { code: 1, list, ...(pages ? { page: Number(pages[1]), pagecount: Number(pages[2]) } : {}), ...(total ? { total: Number(total[1]) } : {}) };
}

export async function nuomiDetail(site, id, readText, options) {
  if (!/^\d+$/.test(id)) throw new SourceError("糯米影片编号无效。", 400);
  const [detail, player] = await Promise.all([
    page(site, `/vod-detail-id-${id}.html`, readText, options),
    page(site, `/vod-play-id-${id}-src-1-num-1.html`, readText, options),
  ]);
  const $ = load(detail), name = clean($("h1.title").text());
  if (!name) throw new SourceError("糯米详情缺少影片名称，站点结构可能已变化。", 502);
  const from = scriptString(player, "mac_from").split("$$$"), groups = scriptString(player, "mac_url").split("$$$");
  if (from.length !== groups.length) throw new SourceError("糯米播放线路与集列表数量不一致。", 502);
  const value = (label) => {
    const item = $(".desc_item").filter((_, el) => clean($(el).children("span").first().text()).replace(/[:：]\s*$/, "") === label).first();
    return clean(item.clone().children("span").remove().end().text());
  };
  const play = groups.map((group, index) => group.split("#").filter(Boolean).map((item) => {
    const delimiter = item.indexOf("$");
    if (delimiter < 1) throw new SourceError("糯米集列表缺少原始播放标识。", 502);
    const data = { url: item.slice(delimiter + 1), flag: from[index] };
    return `${item.slice(0, delimiter)}$${Buffer.from(JSON.stringify(data)).toString("base64url")}`;
  }).join("#")).join("$$$");
  return { code: 1, list: [{ vod_id: id, vod_name: name,
    vod_pic: absolute(site, $(".content img").first().attr("src")), type_name: clean($(".type-title").text()),
    vod_actor: value("主演"), vod_director: value("导演"), vod_year: value("年代"), vod_remarks: value("状态"),
    vod_content: clean($("section.mod p").filter((_, el) => /^简\s*介/.test($(el).text())).first().text()).replace(/^简\s*介\s*[:：]/, "").trim(),
    vod_play_from: from.join("$$$"), vod_play_url: play,
  }] };
}

export async function nuomiPlay(site, raw, readText, options) {
  const episode = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  if (!/^[a-zA-Z0-9_]+$/.test(episode.flag)) throw new SourceError("糯米播放器标识无效。", 502);
  const script = await page(site, `/player/${episode.flag}.js`, readText, options);
  const prefix = script.match(/src=["']([^"']+)['"]\s*\+\s*MacPlayer\.PlayUrl/)?.[1];
  if (!prefix) throw new SourceError("糯米播放器地址格式已变化。", 502);
  const parser = new URL(prefix + episode.url, `${site.requestApi}/`);
  const html = await page(site, parser.href, readText, options);
  const media = validateRemoteUrl(scriptString(html, "url", true));
  if (!/\.(?:m3u8|mp4)$/i.test(media.pathname)) throw new SourceError("糯米未返回已核实的 HLS/MP4 媒体。", 502);
  return { url: media.href, headers: { "user-agent": UA, referer: parser.href } };
}
