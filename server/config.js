import { isIP } from "node:net";

/** 本地浏览入口随服务端口变化；开发入口单独保留。 */
export function localOrigins(port = 4781) {
  return [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "http://127.0.0.1:5190",
    "http://localhost:5190",
  ];
}

/** 部署域名仅接受精确 HTTP(S) origin，不接受通配、路径或凭据。 */
export function parseOrigins(value = "") {
  if (!value.trim()) return [];
  return value.split(",").map((part) => {
    const input = part.trim();
    let url;
    try { url = new URL(input); } catch { throw Error("TVBOX_ORIGINS 必须是逗号分隔的完整 HTTP(S) 页面地址。"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*") || !url.hostname)
      throw Error("TVBOX_ORIGINS 不能包含通配符、路径、查询或账号密码。");
    return url.origin;
  });
}

export function readServerConfig(env = process.env) {
  const host = env.TVBOX_HOST ?? "127.0.0.1";
  if (host !== "localhost" && !isIP(host))
    throw Error("TVBOX_HOST 必须为 localhost 或有效的监听 IP。");
  const rawPort = env.TVBOX_PORT ?? "4781";
  if (!/^[1-9]\d*$/.test(rawPort) || Number(rawPort) > 65535)
    throw Error("TVBOX_PORT 必须为 1–65535 的整数。");
  const port = Number(rawPort);
  return {
    host,
    port,
    production: env.NODE_ENV === "production",
    origins: [...new Set([...localOrigins(port), ...parseOrigins(env.TVBOX_ORIGINS)])],
  };
}
