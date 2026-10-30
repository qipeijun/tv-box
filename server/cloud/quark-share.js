import { SourceError, validateRemoteUrl } from "../remote.js";

const BASE = "https://pan.quark.cn/1/clouddrive";
export const QUARK_HEADERS = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36", origin: "https://pan.quark.cn", referer: "https://pan.quark.cn/", "content-type": "application/json;charset=UTF-8" };

export function quarkShare(address, passcode) {
  const url = validateRemoteUrl(address);
  const id = url.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
  if (url.hostname !== "pan.quark.cn" || !id) throw new SourceError("此入口不是已核实的夸克分享。");
  return { id, passcode: passcode ?? url.searchParams.get("pwd") ?? "" };
}

export function quarkData(body, action) {
  if (body?.code !== 0 || body.data === null || typeof body.data !== "object")
    throw new SourceError(`夸克${action}失败：${body?.message || body?.msg || `接口状态 ${body?.code ?? "未知"}`}`, 502);
  return body.data;
}

export async function quarkShareToken(share, readJson, options) {
  const body = await readJson(`${BASE}/share/sharepage/token?pr=ucpro&fr=pc`, {
    ...options, method: "POST", headers: QUARK_HEADERS, body: JSON.stringify({ pwd_id: share.id, passcode: share.passcode }),
  });
  const data = quarkData(body, "分享访问");
  if (typeof data.stoken !== "string" || !data.stoken) throw new SourceError("夸克未返回分享访问令牌。", 502);
  return data.stoken;
}

/** 仅读取公开目录；分享令牌只用于本次展开，不写入账号文件或返回页面。 */
export async function quarkShareListing(share, readJson, options = {}) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
  const stoken = await quarkShareToken(share, readJson, { signal });
  const queue = ["0"], seen = new Set(), files = [];
  let entries = 0;
  while (queue.length) {
    signal.throwIfAborted();
    const parent = queue.shift();
    if (seen.has(parent)) continue;
    seen.add(parent);
    if (seen.size > 100) throw new SourceError("分享包含过多目录，暂不能完整展开。", 422);
    let fetched = 0;
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({ pr: "ucpro", fr: "pc", pwd_id: share.id, stoken, pdir_fid: parent,
        _page: String(page), _size: "100", _sort: "file_type:asc,updated_at:desc" });
      const data = quarkData(await readJson(`${BASE}/share/sharepage/detail?${query}`, { signal, headers: QUARK_HEADERS }), "目录读取");
      if (!Array.isArray(data.list)) throw new SourceError("夸克分享目录格式无效。", 502);
      fetched += data.list.length;
      entries += data.list.length;
      if (entries > 1000) throw new SourceError("分享包含超过 1000 个条目，暂不能完整展开。", 422);
      for (const item of data.list) {
        if (typeof item.fid !== "string" || typeof item.file_name !== "string") throw new SourceError("夸克目录缺少文件身份。", 502);
        if (item.dir === true) queue.push(item.fid);
        else if (item.file === true && item.category === 1) files.push({ fid: item.fid, name: item.file_name, parent,
          fileToken: item.share_fid_token, size: item.size, format: item.format_type });
      }
      const total = data.metadata?._total ?? data.total;
      if (typeof total === "number" && fetched >= total) break;
      if (data.list.length < 100) break;
      if (page >= 10) throw new SourceError("分享目录分页超过读取上限，未将截断列表作为完整目录。", 422);
    }
  }
  return { files, stoken };
}

/** 页面目录仅读取文件；同次目录的访问令牌只由后端转存流程使用。 */
export async function quarkShareFiles(share, readJson, options) {
  return (await quarkShareListing(share, readJson, options)).files;
}
