import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { CookieJar } from "tough-cookie";
import { SourceError, validateRemoteUrl } from "../remote.js";
import { quarkShareListing, QUARK_HEADERS } from "./quark-share.js";

const apiPath = (path) => `/1/clouddrive/${path}${path.includes("?") ? "&" : "?"}pr=ucpro&fr=pc`;
const IDLE = 61 * 60_000;

/** 单账号串行管理本应用的转存记录；平台任务中断后保留任务编号，重试不重复提交。 */
export function createQuarkPlayback({ auth, readJson, revoke, now = Date.now, wait = delay }) {
  let queue = Promise.resolve();
  const activity = new Map();
  const closing = new Set();
  const serial = (action) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const request = (account, path, options) => auth.requestAccount(account, apiPath(path), options);
  const update = (account, change) => auth.store.update(account.revision, change);
  async function current() {
    const account = await auth.store.get();
    if (!account) throw new SourceError("请先登录夸克网盘后播放。", 401);
    return account;
  }
  async function setEntry(account, entry) {
    await update(account, (saved) => ({ ...saved, owned: [...saved.owned.filter((item) => item.key !== entry.key), entry] }));
  }
  async function folderFor(account) {
    const saved = await current();
    if (saved.folder?.fid) return saved.folder.fid;
    if (saved.folder) throw new SourceError("上次创建临时目录的结果尚未确认，请检查网盘后重新登录；不会重复创建目录。", 409);
    const name = `映场临时观看-${randomUUID()}`;
    // creating：已准备提交建目录请求；结果不明时不通过同名搜索认领用户目录。
    await update(account, (saved) => ({ ...saved, folder: { name, state: "creating" } }));
    const data = await request(account, "file", { method: "POST", body: { pdir_fid: "0", file_name: name, dir: true } });
    const fid = data.fid ?? data.file?.fid;
    if (typeof fid !== "string" || !fid) throw new SourceError("夸克未返回新目录编号，已停止转存。", 502);
    await update(account, (saved) => ({ ...saved, folder: { name, fid } }));
    return fid;
  }
  async function savedFile(account, selection, signal) {
    const key = JSON.stringify([selection.share.id, selection.fid]);
    let entry = (await current()).owned.find((item) => item.key === key);
    if (entry?.state === "ready") return entry;
    if (entry?.state === "submitting") throw new SourceError("上次转存提交结果未确认，不能重复提交；请检查专用目录。", 409);
    signal?.throwIfAborted();
    if (!entry || entry.state === "failed") {
      const { files, stoken } = await quarkShareListing(selection.share, readJson, { signal });
      const file = files.find((item) => item.fid === selection.fid);
      if (!file) throw new SourceError("所选文件已从分享中移除，请重新读取详情。", 404);
      if (typeof file.fileToken !== "string" || !file.fileToken) throw new SourceError("分享未提供所选文件的转存令牌。", 502);
      // 文件转存令牌与本次分享访问令牌配对，不能再次获取 stoken 后混用旧 fileToken。
      const folder = await folderFor(account);
      signal?.throwIfAborted();
      // submitting：写入请求即将发出、结果可能不明；不自动重新提交。
      entry = { key, state: "submitting", createdAt: now(), lastUsed: now() };
      await setEntry(account, entry);
      // 写请求不绑定页面断开信号：已发出的云端任务仍需登记，避免迟到文件失去归属。
      let data;
      try {
        data = await request(account, "share/sharepage/save", { method: "POST", body: {
          fid_list: [file.fid], fid_token_list: [file.fileToken], to_pdir_fid: folder,
          pwd_id: selection.share.id, stoken, pdir_fid: "0", scene: "link",
        } });
      } catch (error) {
        if (error.rejected) await setEntry(account, { ...entry, state: "failed" });
        throw error;
      }
      if (typeof data.task_id !== "string" || !data.task_id) throw new SourceError("夸克未返回转存任务编号，请检查专用目录；不会重复提交。", 502);
      // transferring：云端已接受转存任务，可按任务编号继续查询。
      entry = { ...entry, state: "transferring", task: data.task_id };
      await setEntry(account, entry);
    }
    if (entry.state !== "transferring") throw new SourceError("临时文件状态未确认，请稍后重试。", 409);
    for (let attempt = 0; attempt < 20; attempt++) {
      signal?.throwIfAborted();
      const task = await request(account, `task?task_id=${encodeURIComponent(entry.task)}`, { signal });
      // 平台任务状态：2 已完成；3 已失败；其他状态继续等待，不视为成功。
      if (task.status === 2) {
        const fids = task.save_as?.save_as_top_fids;
        if (!Array.isArray(fids) || fids.length !== 1 || typeof fids[0] !== "string" || !fids[0])
          throw new SourceError("转存结果未准确返回所选的一个文件，已停止播放与自动清理。", 502);
        // ready：任务已确认返回本应用转存文件的身份，允许播放及过期清理。
        entry = { ...entry, state: "ready", fid: fids[0], lastUsed: now() };
        await setEntry(account, entry);
        return entry;
      }
      if (task.status === 3) {
        // failed：平台明确报告失败，下次用户重试可重新提交所选文件。
        await setEntry(account, { ...entry, state: "failed" });
        throw new SourceError("夸克转存任务失败，请检查容量或平台限制后重试。", 502);
      }
      if (attempt < 19) await wait(1000, undefined, { signal });
    }
    throw new SourceError("转存任务尚未完成，已保留任务编号；重试将继续查询。", 504);
  }
  async function play(selection, { signal } = {}) {
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
    return serial(async () => {
      signal?.throwIfAborted();
      const account = await current();
      const entry = await savedFile(account, selection, signal);
      const data = await request(account, "file/v2/play", { method: "POST", signal, body: {
        fid: entry.fid, resolutions: "normal,low,high,super,2k,4k", supports: "fmp4",
      } });
      const variants = Array.isArray(data.video_list) ? data.video_list : [];
      // 平台列表最后一条为较低码率；只选实际返回的有效地址，不伪造会员或转码结果。
      const url = variants.map((item) => item.video_info?.url).filter((value) => typeof value === "string" && value).at(-1);
      if (!url) throw new SourceError("夸克尚未提供可播放的转码地址，请检查转码进度或账号权限后重试。", 422);
      const target = validateRemoteUrl(url);
      if (target.protocol !== "https:") throw new SourceError("夸克媒体未使用 HTTPS，已停止发送登录凭据。", 502);
      const latest = await current();
      if (latest.revision !== account.revision) throw new SourceError("夸克登录已变化，请重新选择播放。", 401);
      const owner = `quark:${account.revision}:${entry.fid}:`;
      const touch = () => activity.set(owner, now());
      touch();
      await setEntry(account, { ...entry, lastUsed: now() });
      // 媒体凭据来自夸克登录域，发送范围由媒体代理固定为此 HTTPS 地址的精确来源。
      return { url: target.href, headers: { ...QUARK_HEADERS, origin: "https://pan.quark.cn",
        cookie: CookieJar.deserializeSync(latest.jar).getCookieStringSync("https://pan.quark.cn/") }, owner, onUse: touch,
        isActive: () => !closing.has(account.revision) && auth.isActive(account.revision) };
    });
  }
  async function cleanup() {
    return serial(async () => {
      const account = await current();
      let removed = 0;
      for (const entry of account.owned) {
        const owner = `quark:${account.revision}:${entry.fid}:`;
        if (entry.state !== "ready" || now() - Math.max(entry.lastUsed, activity.get(owner) ?? 0) < IDLE) continue;
        // 只按已完成任务返回的文件编号删除；不删除目录、不按名称或目录位置猜测归属。
        revoke(owner);
        await request(account, "file/delete", { method: "POST", body: { action_type: 2, filelist: [entry.fid], exclude_fids: [] } });
        await update(account, (saved) => ({ ...saved, owned: saved.owned.filter((item) => item.key !== entry.key) }));
        activity.delete(owner); removed++;
      }
      return { removed, retained: (await current()).owned.length };
    });
  }
  async function status() {
    const account = await auth.store.get();
    return { temporaryFiles: account?.owned.filter((item) => item.state === "ready").length ?? 0,
      pendingTransfers: account?.owned.filter((item) => item.state !== "ready" && item.state !== "failed").length ?? 0 };
  }
  async function logout() {
    const account = await auth.store.get().catch(() => null);
    // 先停止旧播放，正在登记的云端写任务结束后再清除凭据，保留可确认的文件归属。
    if (account) { closing.add(account.revision); revoke(`quark:${account.revision}:`); }
    return serial(async () => {
      const remaining = await status();
      await auth.logout();
      if (account) closing.delete(account.revision);
      activity.clear();
      return { state: "logged_out", ...remaining, warning: remaining.temporaryFiles || remaining.pendingTransfers
        ? "已撤销本应用登录和播放授权。尚有临时文件或云端任务，退出后本应用不能继续清理，请在网盘中检查“映场临时观看”目录。" : "" };
    });
  }
  return { play, cleanup, status, logout };
}
