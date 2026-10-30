import { mkdir, readFile, writeFile, rename, chmod, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SourceError } from "../remote.js";

/** 家庭后端一份夸克授权；只存服务端私有文件，不返回 Cookie。 */
export function createQuarkAccountStore(directory) {
  const root = resolve(directory), file = join(root, "quark-account.json");
  let loaded, account;
  let pending = Promise.resolve();
  async function load() {
    loaded ??= (async () => {
      try {
        const saved = JSON.parse(await readFile(file, "utf8"));
        if (saved.version !== 1 || typeof saved.account?.revision !== "string" || !saved.account.jar || !Array.isArray(saved.account.owned))
          throw new SourceError("夸克登录文件格式无效，请退出后重新登录。", 500);
        account = saved.account;
        await chmod(root, 0o700); await chmod(file, 0o600);
      } catch (error) {
        if (error.code === "ENOENT") account = null;
        else if (error instanceof SourceError) throw error;
        else throw new SourceError("无法读取夸克登录文件，请检查数据目录。", 500);
      }
    })();
    await loaded;
  }
  function schedule(action) {
    const operation = pending.then(action);
    pending = operation.catch(() => {});
    return operation;
  }
  async function persist(next) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      await chmod(root, 0o700);
      if (!next) {
        try { await unlink(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
        return;
      }
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, JSON.stringify({ version: 1, account: next }), { mode: 0o600, flag: "wx" });
        await rename(temp, file); await chmod(file, 0o600);
      } finally { await unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
  }
  return {
    async get() { await load(); await pending; return account; },
    async set(next, { guard = () => true } = {}) {
      await load();
      return schedule(async () => {
        if (!guard()) throw new SourceError("登录请求已取消。", 410);
        const previous = account;
        await persist(next);
        if (!guard()) { await persist(previous); throw new SourceError("登录请求已取消。", 410); }
        account = next;
      });
    },
    /** 只更新仍为本次登录的凭据，迟到响应不能在退出后重新创建旧账号。 */
    async update(revision, update) {
      await load();
      return schedule(async () => {
        if (!account || account.revision !== revision) throw new SourceError("夸克登录已变化，请重新选择播放。", 401);
        const next = update(structuredClone(account));
        await persist(next); account = next; return next;
      });
    },
    async clear() {
      try { await load(); } catch (error) { if (!(error instanceof SourceError)) throw error; }
      return schedule(async () => { await persist(null); account = null; loaded = Promise.resolve(); });
    },
  };
}
