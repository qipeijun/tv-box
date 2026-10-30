import { SourceError } from "../remote.js";
import { createHash } from "node:crypto";
import { quarkShare, quarkShareFiles } from "../cloud/quark-share.js";

const ORIGIN = "https://www.kkpans.com";
function resource(item) {
  if ((!Number.isSafeInteger(item?.id) && typeof item?.id !== "string") || typeof item.file_name !== "string")
    throw new SourceError("KK 网盘资源缺少编号或名称。", 502);
  return { vod_id: String(item.id), vod_name: item.file_name, vod_content: item.description ?? "",
    type_name: item.category_name ?? "网盘资源", vod_remarks: item.target_platform === "quark" ? "夸克分享 · 需登录播放" : `网盘平台：${item.target_platform ?? "未提供"}` };
}
export const kkpansAdapter = {
  async categories(_site, io) {
    const body = await io.json(`${ORIGIN}/api/resource-categories/public`);
    if (!Array.isArray(body?.data)) throw new SourceError("KK 网盘分类格式无效。", 502);
    return body.data.filter((item) => item.enabled === true).map((item) => ({ id: item.slug, name: item.name }));
  },
  async page(_site, query, io, options) {
    if (query.category && !/^[a-zA-Z0-9_-]+$/.test(query.category)) throw new SourceError("KK 网盘分类编号无效。", 400);
    const url = new URL(query.category && !query.search ? `/api/resource-categories/public/${query.category}/resources` : "/api/resources/public", ORIGIN);
    url.searchParams.set("page", String(query.page));
    if (query.search) url.searchParams.set("search", query.search);
    if (!query.category || query.search) url.searchParams.set("file_type", "video");
    const body = await io.json(url.href, options);
    if (!Array.isArray(body?.data) || ![body.total, body.page, body.limit].every(Number.isSafeInteger) || body.limit < 1)
      throw new SourceError("KK 网盘分页格式无效。", 502);
    return { code: 1, list: body.data.map(resource), page: body.page, pagecount: Math.max(1, Math.ceil(body.total / body.limit)), total: body.total };
  },
  async detail(_site, id, io, options) {
    if (!/^\d+$/.test(id)) throw new SourceError("KK 网盘资源编号无效。", 400);
    const body = await io.json(`${ORIGIN}/api/resources/public/${id}`, options);
    const film = resource(body?.data);
    if (film.vod_id !== id) throw new SourceError("KK 网盘详情返回了其他资源。", 502);
    const item = body.data;
    if (item.target_platform !== "quark") return { code: 1, list: [{ ...film,
      vod_content: `此分享平台尚未接入播放。${film.vod_content}`, vod_play_from: "", vod_play_url: "" }] };
    const share = quarkShare(item.share_link, item.share_code);
    const files = await quarkShareFiles(share, io.json, options);
    // CMS 分隔符仅用于内部传输；原文件名保留在数据中，在页面边界恢复。
    const play = files.map((file, index) => `文件${index + 1}$${Buffer.from(JSON.stringify({ share, fid: file.fid, name: file.name })).toString("base64url")}`).join("#");
    return { code: 1, list: [{ ...film, vod_play_from: files.length ? "夸克网盘 · 需登录" : "", vod_play_url: play }] };
  },
  publicEpisode: (episode) => ({ platform: "quark", name: JSON.parse(Buffer.from(episode.playbackId, "base64url").toString("utf8")).name }),
  selectionRef(raw) {
    const data = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return createHash("sha256").update(JSON.stringify([data.share.id, data.fid])).digest("hex");
  },
  async play(_site, raw, io, options) {
    if (!io.cloud) throw new SourceError("请先登录夸克网盘后播放。", 401);
    return io.cloud.play(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")), options);
  },
};
