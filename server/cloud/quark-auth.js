import { randomUUID } from "node:crypto";
import { CookieJar } from "tough-cookie";
import QRCode from "qrcode";
import { SourceError } from "../remote.js";
import { quarkData, QUARK_HEADERS } from "./quark-share.js";

const CAS = "https://uop.quark.cn/cas/ajax/";
function loginUrl(action, token) {
  const url = new URL(action, CAS);
  for (const [key, value] of Object.entries({ client_id: "532", v: "1.2", request_id: randomUUID().toLowerCase(), ...(token ? { token } : {}) })) url.searchParams.set(key, value);
  return url.href;
}
const platformHost = (url) => url.hostname === "quark.cn" || url.hostname.endsWith(".quark.cn");
function absorb(jar, url, responseHeaders) {
  if (!platformHost(url)) throw new SourceError("夸克授权跳转到未核实地址。", 502);
  const values = responseHeaders["set-cookie"];
  for (const cookie of Array.isArray(values) ? values : values ? [values] : []) jar.setCookieSync(cookie, url.href);
}

/** 独立 HTTP 扫码会话；Cookie 只在后端兑换和持久化，不读取用户浏览器资料。 */
export function createQuarkAuth({ store, readJson, readResponse, revoke = () => {} }) {
  let generation = 0, pending;
  const controllers = new Map();
  function controllerFor(revision) {
    if (!controllers.has(revision)) controllers.set(revision, new AbortController());
    return controllers.get(revision);
  }
  function invalidate(revision) {
    controllerFor(revision).abort(); controllers.delete(revision); revoke(`quark:${revision}:`);
  }
  async function status() {
    const account = await store.get();
    return { platform: "quark", state: account ? "logged_in" : "logged_out", updatedAt: account?.updatedAt ?? null };
  }
  async function requestAccount(account, path, { method = "GET", body, signal, candidate = false } = {}) {
    const current = candidate ? account : await store.get();
    if (!current || current.revision !== account.revision) throw new SourceError("请先登录夸克网盘后播放。", 401);
    const jar = CookieJar.deserializeSync(current.jar);
    const url = new URL(path, "https://drive.quark.cn");
    if (!platformHost(url)) throw new SourceError("夸克账号接口地址无效。", 502);
    const active = controllerFor(current.revision).signal;
    const response = await readResponse(url.href, {
      method, ...(body ? { body: JSON.stringify(body) } : {}), headers: QUARK_HEADERS,
      acceptHttpErrors: true,
      signal: signal ? AbortSignal.any([signal, active]) : active,
      headersFor: (target) => {
        if (!platformHost(target)) throw new SourceError("夸克账号跳转到未核实地址。", 502);
        return { cookie: jar.getCookieStringSync(target.href) };
      },
      onHeaders: (target, responseHeaders) => absorb(jar, target, responseHeaders),
    });
    let result;
    try { result = JSON.parse(response.text); } catch { throw new SourceError(`夸克接口${response.statusCode >= 400 ? `返回 HTTP ${response.statusCode}，` : ""}未返回有效 JSON。`, 502); }
    const after = candidate ? account : await store.get();
    if (!after || after.revision !== current.revision) throw new SourceError("夸克登录已变化，请重新选择播放。", 401);
    const serialized = jar.serializeSync();
    if (candidate) account.jar = serialized;
    else if (JSON.stringify(serialized.cookies) !== JSON.stringify(after.jar.cookies))
      await store.update(current.revision, (saved) => ({ ...saved, jar: serialized }));
    if (response.statusCode >= 400 || result?.code !== 0) {
      const failure = new SourceError(`夸克账号请求失败${response.statusCode >= 400 ? `（HTTP ${response.statusCode}）` : ""}：${result?.message || result?.msg || `接口状态 ${result?.code ?? "未知"}`}`, 502);
      // 平台明确返回业务失败时才确认未接受写入；网络中断或非 JSON 拒绝页仍保留未确认状态。
      failure.rejected = typeof result?.code === "number" && result.code !== 0;
      throw failure;
    }
    return quarkData(result, "账号请求");
  }
  async function start(options = {}) {
    if (await store.get()) throw new SourceError("已保存夸克登录，请先退出后再切换账号。", 409);
    const version = ++generation;
    pending?.controller.abort();
    pending = undefined;
    const response = await readJson(loginUrl("getTokenForQrcodeLogin"), { ...options, headers: QUARK_HEADERS });
    if (generation !== version) throw new SourceError("二维码请求已被更新。", 409);
    const token = response?.data?.members?.token;
    if (response?.status !== 2000000 || typeof token !== "string" || !token) throw new SourceError(`夸克二维码创建失败（状态 ${response?.status ?? "未知"}）。`, 502);
    const text = `https://su.quark.cn/4_eMHBJ?token=${encodeURIComponent(token)}&client_id=532&ssb=weblogin&uc_param_str=&uc_biz_str=S%3Acustom%7COPT%3ASAREA%400%7COPT%3AIMMERSIVE%401%7COPT%3ABACK_BTN_STYLE%400`;
    const id = randomUUID();
    pending = { id, token, version, createdAt: Date.now(), controller: new AbortController(), polling: null };
    const image = await QRCode.toDataURL(text, { width: 320, margin: 2 });
    if (generation !== version) throw new SourceError("二维码已取消或更新。", 410);
    return { id, image, state: "waiting" };
  }
  async function authorize(session, options) {
    const response = await readJson(loginUrl("getServiceTicketByQrcodeToken", session.token), { ...options,
      signal: options?.signal ? AbortSignal.any([options.signal, session.controller.signal]) : session.controller.signal, headers: QUARK_HEADERS });
    if (pending !== session || session.version !== generation) throw new SourceError("二维码已取消或更新。", 410);
    if (response?.status === 50004001) return { state: "waiting" };
    if (response?.status !== 2000000) throw new SourceError(`夸克扫码返回状态 ${response?.status ?? "未知"}，请刷新二维码重试。`, 502);
    const ticket = response?.data?.members?.service_ticket;
    if (typeof ticket !== "string" || !ticket) throw new SourceError("夸克尚未返回授权票据，请刷新二维码。", 502);
    const jar = new CookieJar();
    const target = new URL("https://pan.quark.cn/account/info");
    target.searchParams.set("st", ticket); target.searchParams.set("lw", "scan");
    await readResponse(target.href, { signal: session.controller.signal, headers: QUARK_HEADERS,
      headersFor: (url) => {
        if (!platformHost(url)) throw new SourceError("夸克授权地址异常。", 502);
        return { cookie: jar.getCookieStringSync(url.href) };
      }, onHeaders: (url, values) => absorb(jar, url, values),
    });
    if (!jar.getCookiesSync("https://pan.quark.cn/").some((cookie) => cookie.key === "__pus" && cookie.value)) throw new SourceError("夸克授权未取得完整登录状态，请重新扫码。", 502);
    if (pending !== session || generation !== session.version) throw new SourceError("扫码会话已取消。", 410);
    const previous = await store.get();
    const account = { revision: randomUUID(), jar: jar.serializeSync(), updatedAt: new Date().toISOString(), folder: null, owned: [] };
    try {
      await requestAccount(account, "/1/clouddrive/member?pr=ucpro&fr=pc&fetch_subscribe=true&fetch_identity=true", { signal: session.controller.signal, candidate: true });
      await store.set(account, { guard: () => pending === session && generation === session.version });
    } catch (error) { invalidate(account.revision); throw error; }
    if (previous) invalidate(previous.revision);
    pending = undefined;
    return { state: "authorized" };
  }
  async function poll(id, options) {
    const session = pending;
    if (!session || session.id !== id) throw new SourceError("二维码已取消或更新，请重新生成。", 410);
    // 十分钟是本应用会话上限，不作为平台二维码的固定有效期。
    if (Date.now() - session.createdAt > 10 * 60_000) { cancel(id); return { state: "expired" }; }
    session.polling ??= authorize(session, options).finally(() => { session.polling = null; });
    return session.polling;
  }
  function cancel(id) {
    if (pending?.id === id) { generation++; pending.controller.abort(); pending = undefined; }
  }
  async function logout() {
    generation++; pending?.controller.abort(); pending = undefined;
    const account = await store.get().catch(() => null);
    if (account) invalidate(account.revision);
    await store.clear();
    return { state: "logged_out" };
  }
  return { status, start, poll, cancel, logout, requestAccount, store,
    isActive(revision) { const controller = controllers.get(revision); return !!controller && !controller.signal.aborted; },
    close() { generation++; pending?.controller.abort(); pending = undefined; for (const controller of controllers.values()) controller.abort(); controllers.clear(); },
  };
}
