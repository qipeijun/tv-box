import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  Library,
  LoaderCircle,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Tv,
} from "lucide-react";
import VideoPlayer from "./video-player";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  api,
  type LiveChannel,
  type LivePlaylist,
  type Subscription,
} from "@/lib/api";

type LiveSelection =
  | { builtinId: string }
  | { url: string }
  | { subscriptionId: string; playlistId: string };
type LiveBuiltin = { id: string; name: string; description: string };
const STORAGE_KEY = "tvbox.live.v1";
function initialSelection(): { selection: LiveSelection; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { selection: { builtinId: "featured" }, error: "" };
    const saved = JSON.parse(raw);
    if (
      saved.version !== 1 ||
      !(
        typeof saved.selection?.builtinId === "string" ||
        (typeof saved.selection?.url === "string" &&
          /^https?:\/\//.test(saved.selection.url) &&
          URL.canParse(saved.selection.url))
      )
    )
      throw Error("invalid");
    return { selection: saved.selection, error: "" };
  } catch {
    return {
      selection: { builtinId: "featured" },
      error: "无法读取本机直播设置，已打开公共直播精选。",
    };
  }
}

function ChannelLogo({ channel }: { channel: LiveChannel }) {
  const [failed, setFailed] = useState(false);
  return channel.logo && !failed ? (
    <img
      src={channel.logo}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <Tv aria-hidden="true" />
  );
}

export default function LiveView({
  subscription,
  onLeave,
}: {
  subscription: Subscription | null;
  onLeave: () => void;
}) {
  const [initial] = useState(initialSelection);
  const [selection, setSelection] = useState<LiveSelection>(initial.selection);
  const [builtins, setBuiltins] = useState<LiveBuiltin[]>([]);
  const [playlist, setPlaylist] = useState<LivePlaylist | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(initial.error);
  const [managerOpen, setManagerOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const request = useRef<AbortController | null>(null);
  const lastAttempt = useRef<LiveSelection>(initial.selection);
  const audio = useRef({ volume: 1, muted: false });
  const channelHeading = useRef<HTMLHeadingElement>(null);
  const selected = playlist?.channels.find(
    (channel) => channel.id === selectedId,
  );
  const groups = [
    ...new Set(
      playlist?.channels.map((channel) => channel.group).filter(Boolean),
    ),
  ];
  const visibleChannels =
    playlist?.channels.filter(
      (channel) =>
        (!group || channel.group === group) &&
        channel.name
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    ) ?? [];

  async function load(next: LiveSelection) {
    lastAttempt.current = next;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api<LivePlaylist>("/live/playlists", {
        method: "POST",
        body: JSON.stringify(next),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPlaylist(result);
      setSelection(next);
      setSelectedId((previous) =>
        result.channels.some(
          (channel) => channel.id === previous && channel.mime && channel.url,
        )
          ? previous
          : (result.channels.find((channel) => channel.mime && channel.url)
              ?.id ?? ""),
      );
      setGroup("");
      setQuery("");
      setManagerOpen(false);
      // 订阅会话编号会过期，只持久化内置选择或自定义地址。
      if (!("subscriptionId" in next)) {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ version: 1, selection: next }),
          );
          setStorageError("");
        } catch {
          setStorageError("本次直播已打开，但浏览器无法保存片库选择。");
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError((reason as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    api<{ playlists: LiveBuiltin[] }>("/live/playlists", {
      signal: controller.signal,
    })
      .then((data) => setBuiltins(data.playlists))
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    void load(initial.selection);
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [initial]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void load({ url: address.trim() });
  }
  function showChannels() {
    channelHeading.current?.focus({ preventScroll: true });
    channelHeading.current?.scrollIntoView({
      block: "start",
      behavior: "instant",
    });
  }
  return (
    <main id="content" className="live-page">
      <div className="live-page-heading">
        <div>
          <p className="live-eyebrow">
            <Radio />
            此刻，在发生。
          </p>
          <h1>直播</h1>
          <p>{playlist?.name || "打开频道，看看世界。"}</p>
        </div>
        <Button variant="outline" onClick={() => setManagerOpen(true)}>
          <Library />
          直播片库
        </Button>
      </div>
      {storageError ? (
        <p className="source-notice" role="status">
          {storageError}
        </p>
      ) : null}
      {loading ? (
        <p className="live-loading" role="status">
          <LoaderCircle className="animate-spin" />
          正在读取频道…
        </p>
      ) : null}
      {error ? (
        <div className="live-load-error" role="alert">
          <p>
            {error}
            {playlist ? " 仍保留上一次成功的频道列表。" : ""}
          </p>
          <Button
            variant="outline"
            onClick={() => void load(lastAttempt.current)}
          >
            重新读取
          </Button>
          <Button variant="ghost" onClick={() => setManagerOpen(true)}>
            更换直播片库
          </Button>
        </div>
      ) : null}
      <div className="live-layout">
        <section className="live-stage" aria-label="直播画面">
          <div className="live-screen">
            {selected?.mime && selected.url ? (
              <VideoPlayer
                key={selected.id}
                episode={selected}
                title={selected.name}
                subtitle={selected.group || playlist?.name || ""}
                live
                onBack={onLeave}
                onEpisodes={showChannels}
                audioPreferences={audio.current}
                onAudioChange={(value) => {
                  audio.current = value;
                }}
              />
            ) : (
              <div className="live-screen-empty">
                <Tv />
                <h2>{loading ? "频道正在到来" : "选择一个频道"}</h2>
                <p>
                  {playlist
                    ? "从频道列表开始观看。"
                    : "也可以添加你自己的 M3U 直播订阅。"}
                </p>
              </div>
            )}
          </div>
          {selected ? (
            <div className="live-now">
              <div>
                <p className="live-indicator">
                  <span />
                  当前频道
                </p>
                <h2>{selected.name}</h2>
                <p>{selected.group || playlist?.name}</p>
              </div>
              <Button variant="ghost" onClick={showChannels}>
                切换频道
              </Button>
            </div>
          ) : null}
          <p className="live-stream-note">
            频道由第三方提供，可能有地域、跨域或编码限制。
          </p>
        </section>
        <section className="live-channel-browser" aria-label="频道列表">
          <div className="live-channel-heading">
            <h2 ref={channelHeading} tabIndex={-1}>
              频道 <span>{playlist?.channels.length ?? 0}</span>
            </h2>
            <Button
              size="icon"
              variant="ghost"
              aria-label="更新直播频道"
              disabled={loading}
              onClick={() => void load(selection)}
            >
              <RefreshCw />
            </Button>
          </div>
          <div className="live-channel-search">
            <Search />
            <Input
              aria-label="搜索频道"
              placeholder="搜索频道"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              maxLength={100}
            />
          </div>
          {groups.length ? (
            <div className="live-groups" aria-label="频道分组">
              {["", ...groups].map((name) => (
                <button
                  key={name}
                  aria-pressed={group === name}
                  onClick={() => setGroup(name)}
                >
                  {name || "全部"}
                </button>
              ))}
            </div>
          ) : null}
          <div className="live-channel-list">
            {visibleChannels.map((channel) => (
              <button
                className="live-channel"
                key={channel.id}
                aria-current={selectedId === channel.id ? "true" : undefined}
                aria-disabled={!channel.mime || !channel.url}
                onClick={() => {
                  if (channel.mime && channel.url) setSelectedId(channel.id);
                }}
              >
                <span className="live-channel-logo">
                  <ChannelLogo key={channel.logo} channel={channel} />
                </span>
                <span>
                  <strong>{channel.name}</strong>
                  <small>{channel.reason || channel.group || "直播频道"}</small>
                </span>
                {selectedId === channel.id ? <Check /> : null}
              </button>
            ))}
          </div>
          {!loading && !visibleChannels.length ? (
            <p className="live-list-empty">
              {playlist
                ? "没有找到频道，试试其他关键词或分组。"
                : "频道列表尚未载入。"}
            </p>
          ) : null}
        </section>
      </div>
      <Dialog open={managerOpen} onOpenChange={setManagerOpen}>
        <DialogContent className="library-dialog">
          <DialogHeader>
            <DialogTitle>直播片库</DialogTitle>
            <DialogDescription>
              选择内置频道，或添加自己的 M3U 直播订阅。
            </DialogDescription>
          </DialogHeader>
          <div className="library-list">
            {builtins.map((item) => (
              <button
                key={item.id}
                className="library-item"
                disabled={loading}
                onClick={() => void load({ builtinId: item.id })}
              >
                <span className="library-icon">
                  <Radio />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </div>
          {subscription?.livePlaylists.length ? (
            <section className="library-sites">
              <h3>来自 {subscription.name}</h3>
              <div className="library-list">
                {subscription.livePlaylists.map((item) => (
                  <button
                    key={item.id}
                    className="library-item"
                    disabled={loading || !item.supported}
                    onClick={() =>
                      void load({
                        subscriptionId: subscription.id,
                        playlistId: item.id,
                      })
                    }
                  >
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.reason || "读取订阅中的直播列表"}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          <form className="live-add-form" onSubmit={submit}>
            <label htmlFor="live-playlist-url">添加 M3U 订阅</label>
            <Input
              id="live-playlist-url"
              type="url"
              required
              maxLength={2048}
              placeholder="https://example.com/channels.m3u"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            <Button type="submit" disabled={loading}>
              <Plus />
              添加并打开
            </Button>
          </form>
          {error ? (
            <p className="manager-error" role="alert">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="manager-status" role="status">
              <LoaderCircle className="animate-spin" />
              正在读取频道…
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
