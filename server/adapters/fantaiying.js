import { createHash, randomBytes } from "node:crypto";
import { ftyConfig, ftyExt } from "./fty-config.js";
import { SourceError, validateRemoteUrl } from "../remote.js";
import { NUOMI_ORIGIN } from "./nuomi.js";

/** cms：T4 采集接口；rebo：热播签名接口；nuomi：糯米 HTML 站点。其他插件仍明确不支持。 */
export function nativeSite(site) {
  if (site.type !== 3 || site.jar) return null;
  if (site.api === "node_kkpans_public") return { adapter: "kkpans" };
  if (site.api === "csp_YGPGuard") return { adapter: "trailers" };
  if (site.api === "csp_NmyswvGuard") {
    // 当前真实页面关闭搜索；分类仍可浏览，不能把失败伪装为空搜索结果。
    return { adapter: "nuomi", requestApi: NUOMI_ORIGIN, searchable: 0 };
  }
  if (site.api === "csp_T4Guard") {
    const config = ftyConfig(site.ext);
    if (!config.siteUrl) return null;
    validateRemoteUrl(config.siteUrl);
    if (config.playUrl) return null;
    return { adapter: "cms", requestApi: config.siteUrl, categories: config.categories ?? [],
      // 当前采集接口对 wd 明确返回“暂不支持搜索”；分类浏览仍可使用。
      ...(new URL(config.siteUrl).hostname === "api.wsyzy.net" ? { searchable: 0 } : {}),
    };
  }
  if (site.api === "csp_AppTTGuard") {
    const origin = ftyExt(site.ext);
    validateRemoteUrl(origin);
    return { adapter: "rebo", requestApi: origin.replace(/\/$/, "") };
  }
  return null;
}

const SIGN_SALT = "7gp0bnd2sr85ydii2j32pcypscoc4w6c7g5spl";
// 接口契约参考固定上游 ScriptAssets/sites/AppRJ.js；请求签名与字段顺序遵循实际接口。
export async function reboRequest(site, path, fields, readJson, { signal } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = createHash("md5").update(SIGN_SALT + timestamp).digest("hex");
  const boundary = "tvbox" + randomBytes(12).toString("hex");
  const body = Object.entries({ timestamp, sign, ...fields }).map(([key, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
  ).join("") + `--${boundary}--\r\n`;
  const response = await readJson(`${site.requestApi}/v3/${path}`, {
    signal, method: "POST", body,
    headers: { "user-agent": "okhttp-okgo/jeasonlzy", "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  if (!response || typeof response.data !== "object" || response.data === null)
    throw new SourceError(`热播接口返回异常：${response?.msg ?? "缺少 data"}`, 502);
  return response.data;
}

export async function reboCategories(site, readJson) {
  const data = await reboRequest(site, "type/top_type", {}, readJson);
  if (!Array.isArray(data.list)) throw new SourceError("热播分类格式无效。", 502);
  return data.list.map((item) => ({ id: String(item.type_id), name: String(item.type_name) }));
}

export async function reboPage(site, query, readJson, options) {
  const search = !!query.search;
  const data = await reboRequest(site, search ? "home/search" : "home/type_search", {
    ...(search ? { keyword: query.search } : { type_id: query.category ?? "" }), limit: "12", page: String(query.page),
  }, readJson, options);
  if (!Array.isArray(data.list)) throw new SourceError("热播列表格式无效。", 502);
  // 上游若没有总页数则不伪造 9999 页。
  return { code: 1, list: data.list.map((item) => ({ ...item, vod_pic: item.vod_pic || item.vod_pic_thumb })) };
}

export async function reboDetail(site, id, readJson, options) {
  const data = await reboRequest(site, "home/vod_details", { vod_id: id }, readJson, options);
  if (!data.vod_name || !Array.isArray(data.vod_play_list)) throw new SourceError("热播影片详情缺少播放线路。", 502);
  const lines = data.vod_play_list;
  return { code: 1, list: [{
    ...data, vod_id: id, vod_pic: data.vod_pic || data.vod_pic_thumb,
    vod_play_from: lines.map((line) => line.name).join("$$$"),
    vod_play_url: lines.map((line) => (line.urls ?? []).map((episode) =>
      `${episode.name}$${Buffer.from(JSON.stringify({ url: episode.url, parses: line.parse_urls ?? [], ua: line.ua ?? "" })).toString("base64url")}`,
    ).join("#")).join("$$$"),
  }] };
}

export async function reboPlay(raw, readJson, { signal } = {}) {
  const episode = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  let url = episode.url, ua = episode.ua;
  const errors = [];
  for (const parser of episode.parses) {
    signal?.throwIfAborted();
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sign = createHash("md5").update(SIGN_SALT + timestamp).digest("hex");
      const target = `${parser}${episode.url}&sign=${sign}&timestamp=${timestamp}`;
      const parsed = new URL(target);
      // 当前热播真实线路的公开解析接口使用 7788；仅对这一已核实主机开放。
      const parserOrigins = new Set(["https://api.nbyjson.top:7788", "http://192.140.166.127:56", "http://111.170.35.189:3366"]);
      const allowedPorts = parserOrigins.has(parsed.origin) ? [parsed.port] : [];
      const data = await readJson(target, { signal, allowedPorts });
      if (!data.url) throw new SourceError("解析接口未返回媒体地址。");
      url = data.url; ua = data.UA || ua;
      break;
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(error.message);
    }
  }
  if (episode.parses.length && errors.length === episode.parses.length)
    throw new SourceError(`热播线路解析失败：${errors.join("；")}`, 502);
  // 同一已核实解析接口会轮换不同公网 IP 的 9090 媒体节点；授权绑定本次响应的 origin。
  const knownParser = episode.parses.some((parser) => parser.startsWith("https://api.nbyjson.top:7788/api/"));
  const media = validateRemoteUrl(url, { allowedPorts: knownParser ? ["9090"] : [] });
  const allowedOrigins = media.port === "9090" ? [media.origin] : [];
  return { url, headers: ua ? { "user-agent": ua } : {}, ...(allowedOrigins.length ? { allowedOrigins } : {}) };
}
