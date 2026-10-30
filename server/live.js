import { createHash } from "node:crypto";
import { SourceError, validateRemoteUrl } from "./remote.js";

function httpUrl(value, base) {
  return validateRemoteUrl(new URL(value, base).href).href;
}

/** 只读取扩展 M3U 的频道数据；不把 HLS 分片清单当成频道订阅。 */
export function parseM3u(text, base) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (
    lines.find((line) => line) !== "#EXTM3U" &&
    !lines.find((line) => line)?.startsWith("#EXTM3U ")
  )
    throw new SourceError("请输入扩展 M3U 频道列表，文件应以 #EXTM3U 开头。");
  if (
    lines.some((line) =>
      /^#EXT-X-(?:TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE):/.test(line),
    )
  )
    throw new SourceError(
      "这个地址是视频清单，请添加包含频道名称的 M3U 订阅。",
    );
  const channels = [];
  let pending = null;
  for (const line of lines) {
    if (line.startsWith("#EXTINF:")) {
      let quoted = false;
      let comma = -1;
      for (let i = 8; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        if (line[i] === "," && !quoted) {
          comma = i;
          break;
        }
      }
      if (comma === -1 || !line.slice(comma + 1).trim())
        throw new SourceError("M3U 的频道信息缺少名称或分隔逗号。");
      const attributes = Object.fromEntries(
        [...line.slice(0, comma).matchAll(/([\w-]+)="([^"]*)"/g)].map(
          (match) => [match[1], match[2]],
        ),
      );
      let logo = null;
      try {
        if (attributes["tvg-logo"])
          logo = httpUrl(attributes["tvg-logo"], base);
      } catch {
        /* 无有效台标时显示频道名。 */
      }
      pending = {
        name: line.slice(comma + 1).trim(),
        group: attributes["group-title"] || "",
        logo,
        headerRequired: false,
      };
      continue;
    }
    if (pending && line.startsWith("#EXTGRP:"))
      pending.group = line.slice(8).trim();
    if (pending && /^#(?:EXTVLCOPT|KODIPROP):/i.test(line))
      pending.headerRequired = true;
    if (!line || line.startsWith("#") || !pending) continue;
    let url = null;
    let reason = "";
    try {
      url = httpUrl(line, base);
      if (line.includes("|")) reason = "此频道需要附加请求参数，网页暂不支持。";
      if (!new URL(url).pathname.toLowerCase().endsWith(".m3u8"))
        reason = "当前网页直播仅支持 HLS（.m3u8）频道。";
      if (pending.headerRequired)
        reason = "此频道要求专用请求头，浏览器直连暂不支持。";
    } catch (error) {
      reason = error.message;
    }
    const id = createHash("sha256")
      .update(`${pending.name}\n${line}`)
      .digest("hex")
      .slice(0, 20);
    if (!channels.some((channel) => channel.id === id))
      channels.push({
        id,
        name: pending.name,
        group: pending.group,
        logo: pending.logo,
        url,
        mime: reason ? null : "application/x-mpegURL",
        reason,
      });
    pending = null;
    if (channels.length > 5000)
      throw new SourceError("频道超过 5000 个，请使用较小的 M3U 列表。");
  }
  if (!channels.length)
    throw new SourceError(
      "这个列表没有包含可识别的频道，请检查 #EXTINF 与频道地址。",
    );
  return channels;
}

/** 已核实的 TVBox lives[type=0,url] 形状；原生代理和专用请求头保留原因。 */
export function subscriptionLiveEntries(config) {
  if (!Array.isArray(config?.lives)) return [];
  return config.lives.slice(0, 100).map((item, index) => {
    let reason = "";
    if (
      !item ||
      typeof item.name !== "string" ||
      typeof item.url !== "string" ||
      item.type !== 0
    )
      reason = "此直播配置不是已支持的 type: 0 M3U 订阅。";
    else {
      try {
        validateRemoteUrl(item.url);
      } catch (error) {
        reason = error.message;
      }
      if (item.ua) reason = "此直播订阅要求专用请求头，网页暂不支持。";
    }
    return {
      id: String(index),
      name:
        typeof item?.name === "string" ? item.name : `直播入口 ${index + 1}`,
      url: item?.url,
      supported: !reason,
      reason,
    };
  });
}

export const livePlaylists = [
  {
    id: "featured",
    name: "公共直播精选",
    description: "新闻与纪实频道",
    source: "https://github.com/iptv-org/iptv",
    config: `#EXTM3U
#EXTINF:-1 group-title="新闻",CGTN
https://english-livebkali.cgtn.com/live/encgtn.m3u8
#EXTINF:-1 group-title="纪实",CGTN Documentary
https://hlspackager.akamaized.net/live/DB/CGTN_DOCUMENTARY/HLS/CGTN_DOCUMENTARY.m3u8
#EXTINF:-1 group-title="纪实",CNA Originals
https://amg01082-cna-amg01082c1-rlaxx-us-11304.playouts.now.amagi.tv/playlist.m3u8
`,
  },
  {
    id: "china",
    name: "中国频道 · IPTV-org",
    description: "公开频道列表，部分有地域或浏览器限制",
    source: "https://github.com/iptv-org/iptv/blob/master/streams/cn.m3u",
    url: "https://cdn.jsdelivr.net/gh/iptv-org/iptv@master/streams/cn.m3u",
  },
];
