import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Account = {
  /** logged_in：后端保存了登录，实际权限由平台请求核验；logged_out：本应用未保存登录。 */
  state: "logged_in" | "logged_out";
  temporaryFiles: number;
  pendingTransfers: number;
};
type Qr = { id: string; image: string };

/** 仅在弹框打开时挂载；离开后停止轮询并取消本次二维码，不读取浏览器账号资料。 */
export default function CloudManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [account, setAccount] = useState<Account>();
  const [qr, setQr] = useState<Qr>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const life = useRef<AbortController | null>(null);
  const currentQr = useRef<string | null>(null);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    const controller = new AbortController(); life.current = controller;
    api<Account>("/cloud/quark", { signal: controller.signal }).then(setAccount).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message);
    });
    return () => {
      controller.abort();
      if (currentQr.current) void api(`/cloud/quark/qr/${currentQr.current}`, { method: "DELETE", body: "{}" }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (!qr) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        // waiting：尚未确认；authorized：授权已验证并保存；expired：本应用会话已到期。
        const result = await api<{ state: "waiting" | "authorized" | "expired" }>(`/cloud/quark/qr/${qr.id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.state === "authorized") {
          currentQr.current = null; setQr(undefined); changed.current();
          const saved = await api<Account>("/cloud/quark", { signal: life.current?.signal });
          if (!life.current?.signal.aborted) { setAccount(saved); setNotice("夸克登录已保存，可以返回影片重试播放。"); }
        } else if (result.state === "expired") { setQr(undefined); setError("二维码会话已到期，请重新生成。"); }
        else timer = setTimeout(() => void poll(), 2000);
      } catch (failure) {
        if (!controller.signal.aborted) { setQr(undefined); setError((failure as Error).message); }
      }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [qr]);
  async function start() {
    setBusy(true); setError(""); setNotice(""); setQr(undefined);
    try {
      // 不取消已发出的创建请求；即使关闭途中返回，也能取得编号并明确撤销。
      const next = await api<Qr>("/cloud/quark/qr", { method: "POST", body: "{}" });
      if (life.current?.signal.aborted) { await api(`/cloud/quark/qr/${next.id}`, { method: "DELETE", body: "{}" }); return; }
      currentQr.current = next.id; setQr(next);
    } catch (failure) { if (!life.current?.signal.aborted) setError((failure as Error).message); }
    finally { if (!life.current?.signal.aborted) setBusy(false); }
  }
  async function manage(action: "cleanup" | "logout") {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ removed?: number; warning?: string }>(action === "cleanup" ? "/cloud/quark/cleanup" : "/cloud/quark", {
        method: action === "cleanup" ? "POST" : "DELETE",
        body: "{}",
      });
      if (life.current?.signal.aborted) return;
      if (action === "logout") changed.current();
      setNotice(result.warning || (action === "cleanup" ? `已清理 ${result.removed} 个闲置临时文件，活动播放继续保留。` : "本应用登录和播放授权已撤销。"));
      const saved = await api<Account>("/cloud/quark", { signal: life.current?.signal });
      if (!life.current?.signal.aborted) setAccount(saved);
    } catch (failure) { if (!life.current?.signal.aborted) setError((failure as Error).message); }
    finally { if (!life.current?.signal.aborted) setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>网盘登录 · 夸克</DialogTitle>
        <DialogDescription>用你本人的夸克 App 扫码。本机服务保存登录，供连接此服务的家庭设备观看。</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <p role="status">{account ? account.state === "logged_in" ? "已保存夸克登录" : "尚未登录夸克" : "正在读取登录状态…"}</p>
        {error ? <p role="alert">{error}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {qr ? <div className="flex flex-col items-center gap-2">
          <img src={qr.image} width={320} height={320} className="size-64" alt="夸克本人登录二维码" />
          <p>等待你扫码并在手机上确认。关闭面板将停止本次扫码。</p>
        </div> : null}
        {account?.state === "logged_in" ? <>
          <p>临时文件 {account.temporaryFiles} 个，待确认转存 {account.pendingTransfers} 项。仅在必要时转存所选集；闲置超过一小时后清理，正在观看的文件会保留。</p>
          <p>退出会立即撤销本应用播放授权。尚未清理的文件与未完成云端任务，需要你在网盘“映场临时观看”目录中检查。</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void manage("cleanup")}>清理闲置临时文件</Button>
            <Button variant="outline" disabled={busy} onClick={() => void manage("logout")}>退出夸克登录</Button>
          </div>
        </> : <Button disabled={busy || !account} onClick={() => void start()}>{busy ? "正在生成…" : qr ? "刷新二维码" : "生成登录二维码"}</Button>}
        {!account && error ? <Button variant="outline" disabled={busy} onClick={() => void manage("logout")}>清除本应用登录</Button> : null}
        <Button variant="ghost" onClick={onClose}>返回观看</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
