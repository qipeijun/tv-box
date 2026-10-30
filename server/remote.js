import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, request } from "undici";
import { parse as parseJsonc } from "jsonc-parser";

export class SourceError extends Error {
  constructor(message, statusCode = 422) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function isPublicAddress(address) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

/** 仅获取公共 HTTP(S) 资源；每次连接在 DNS 解析后校验地址，防止重绑定绕过。 */
export function validateRemoteUrl(value, { allowedPorts = [] } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SourceError("请输入完整的 HTTP 或 HTTPS 地址。");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443", ...allowedPorts].includes(url.port)) ||
    hostname === "localhost" ||
    (isIP(hostname) && !isPublicAddress(hostname))
  ) {
    throw new SourceError(
      "只允许公共 HTTP(S) 地址及标准端口，不允许内网或带账号的地址。",
    );
  }
  return url;
}

let activeRequests = 0;

/** 每次建立连接都核验 DNS 结果；媒体和内容接口共用同一公网地址边界。 */
export function createRemoteDispatcher() {
  return new Agent({ connections: 2, connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
        if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
          callback(new SourceError("源地址解析到非公网网络，已停止请求。")); return;
        }
        callback(null, options.all ? addresses : addresses[0].address, ...(options.all ? [] : [addresses[0].family]));
      }, callback);
    },
  } });
}

// 主动丢弃错误响应时，undici 会异步发出 AbortError；避免它成为未处理事件。
function discardBody(body) {
  body.on("error", () => {});
  body.destroy();
}

/** 元信息只提供给后端站点会话/账号适配；逐跳边界、响应上限和取消规则与正文读取一致。 */
export async function readRemoteResponse(value, { signal: callerSignal, method = "GET", headers = {}, body, allowedPorts = [], headersFor, onHeaders, acceptHttpErrors = false } = {}) {
  if (!["GET", "POST", "HEAD"].includes(method)) throw new SourceError("不支持的上游请求方法。");
  callerSignal?.throwIfAborted();
  if (activeRequests >= 8)
    throw new SourceError("当前源请求较多，请稍后重试。", 429);
  let url = validateRemoteUrl(value, { allowedPorts });
  activeRequests++;
  const dispatcher = createRemoteDispatcher();
  const timeout = AbortSignal.timeout(15000);
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeout])
    : timeout;
  try {
    // 最多三次跳转，每一跳均重新校验目标协议和地址。
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await request(url, {
        method,
        body,
        dispatcher,
        signal,
        maxRedirections: 0,
        headersTimeout: 15000,
        bodyTimeout: 15000,
        headers: {
          host: url.host,
          accept: "application/json",
          "accept-encoding": "identity",
          "user-agent": "TVBox-Web/0.1",
          ...headers,
          ...headersFor?.(url),
          host: url.host,
        },
      });
      try { await onHeaders?.(url, response.headers); }
      catch (error) { discardBody(response.body); throw error; }
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        discardBody(response.body);
        if (!response.headers.location || redirects === 3)
          throw new SourceError("源地址跳转过多或缺少目标。");
        url = validateRemoteUrl(new URL(response.headers.location, url).href, { allowedPorts });
        continue;
      }
      if (response.statusCode !== 200 && !acceptHttpErrors) {
        discardBody(response.body);
        throw new SourceError(
          `源返回 HTTP ${response.statusCode}，请检查地址或稍后重试。`,
          502,
        );
      }
      const limit = 8 * 1024 * 1024;
      if (Number(response.headers["content-length"]) > limit) {
        discardBody(response.body);
        throw new SourceError("源数据超过 8 MB，暂不支持此配置。");
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) {
          discardBody(response.body);
          throw new SourceError("源数据超过 8 MB，已停止读取。");
        }
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks)
        .toString("utf8")
        .replace(/^\uFEFF/, "");
      return { statusCode: response.statusCode, headers: response.headers, url: url.href, text };
    }
  } catch (error) {
    if (error instanceof SourceError) throw error;
    if (callerSignal?.aborted) throw new SourceError("本次源请求已取消。", 499);
    if (timeout.aborted)
      throw new SourceError("源请求超过 15 秒，请重试或切换站点。", 504);
    // 日志保留底层原因，前端不暴露网络栈或服务端路径。
    throw new SourceError(
      `无法连接源：${error.code || error.cause?.code || error.message}`,
      502,
    );
  } finally {
    activeRequests--;
    await dispatcher.destroy();
  }
}

export async function readRemoteText(value, options) {
  return (await readRemoteResponse(value, options)).text;
}

/** 订阅允许 JSON 注释与已核实的图片 Base64 包装；只解析数据，不加载脚本或 JAR。 */
export function decodeRemoteJson(text, { subscription = false } = {}) {
  if (subscription) {
    const marker = text.lastIndexOf("**");
    const image = text.slice(0, 64).includes("JFIF") || text.startsWith("BM");
    if (image && marker > 0 && marker <= 65536) {
      const encoded = text.slice(marker + 2).trim();
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
        throw new SourceError("订阅图片中的 Base64 配置不完整。");
      text = Buffer.from(encoded, "base64").toString("utf8");
    }
    const errors = [];
    const data = parseJsonc(text, errors, { allowTrailingComma: false });
    if (!errors.length && data && typeof data === "object") return data;
    throw new SourceError(
      "订阅不是有效 JSON 配置，或使用了尚不支持的加密格式。",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SourceError("源返回的不是有效 JSON；首版不支持加密或脚本配置。");
  }
}

export async function readRemoteJson(value, options) {
  return decodeRemoteJson(await readRemoteText(value, options), options);
}
