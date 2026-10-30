import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import {
  ListVideo,
  LoaderCircle,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useViewingDevice } from "@/lib/use-viewing-device";
import { DesktopPlayerNavigation, MobilePlayerNavigation } from "./player-navigation";
import { Button } from "@/components/ui/button";
import type { Episode } from "@/lib/api";
import { resolveResume } from "@/lib/playback";
import "video.js/dist/video-js.css";

/** loading：正在准备媒体；playing：正在播放；paused：已暂停；ended：点播正常播完；error：加载或解码失败。 */
type PlaybackState = "loading" | "playing" | "paused" | "ended" | "error";

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function VideoPlayer({
  episode,
  title,
  subtitle,
  onBack,
  onEpisodes,
  onFindElsewhere,
  onDismissEpisodes,
  onEnded,
  onNext,
  audioPreferences,
  onAudioChange,
  live = false,
  initialPosition = 0,
  onProgress,
  onRetry,
  fullscreenTarget,
}: {
  episode: Episode;
  title: string;
  subtitle: string;
  onBack: () => void;
  onEpisodes: () => void;
  onFindElsewhere?: () => void;
  onDismissEpisodes?: () => boolean;
  onEnded?: () => string | undefined;
  onNext?: () => void;
  audioPreferences: { volume: number; muted: boolean };
  onAudioChange: (audio: { volume: number; muted: boolean }) => void;
  live?: boolean;
  initialPosition?: number;
  onProgress?: (
    progress: { position: number; duration: number; completed: boolean },
    force: boolean,
  ) => void;
  /** 已解析来源重试时重新向后端取地址；普通媒体沿用播放器自身重载。 */
  onRetry?: () => void;
  fullscreenTarget?: RefObject<HTMLDivElement | null>;
}) {
  const mobile = useViewingDevice();
  const Navigation = mobile ? MobilePlayerNavigation : DesktopPlayerNavigation;
  const shell = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<PlaybackState>("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // null 表示跟随播放进度；数值表示用户拖动时预览的位置。
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(audioPreferences.volume);
  const [muted, setMuted] = useState(audioPreferences.muted);
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pipSupported, setPipSupported] = useState(false);
  const lastPosition = useRef(initialPosition);
  const interacting = useRef(false);
  const hoveringControls = useRef(false);
  const scrubPosition = useRef<number | null>(null);

  // 画面点击以按下前的可见性为准，避免 capture 唤出后 click 再次隐藏。
  const tapWasVisible = useRef(true);
  function reveal() {
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    // 仅播放中自动隐藏控件；聚焦控件、暂停或错误时保持可见。
    timer.current = setTimeout(() => {
      if (
        !interacting.current &&
        !hoveringControls.current &&
        !playerRef.current?.paused() &&
        !(
          document.activeElement !== shell.current &&
          document.activeElement?.matches(":focus-visible") &&
          shell.current?.contains(document.activeElement)
        )
      )
        setVisible(false);
    }, 3000);
  }

  useEffect(() => {
    const requestedPosition =
      attempt > 0 ? lastPosition.current : initialPosition;
    setState("loading");
    setError("");
    setNotice("");
    setTime(0);
    setDuration(0);
    setScrubTime(null);
    let active = true;
    // 回报必须绑定本次媒体，切集卸载时不能把旧进度写到新集数。
    const reportProgress = onProgress;
    let hasPlayed = false;
    let restored = requestedPosition <= 0 || live;
    let started = false;
    let resumeFailure = "";
    const report = (force = false, completed = false) => {
      const position = player.error()
        ? lastPosition.current
        : player.currentTime() || 0;
      const total = player.duration() || 0;
      if (
        hasPlayed &&
        !live &&
        Number.isFinite(position) &&
        Number.isFinite(total) &&
        total > 0
      )
        reportProgress?.(
          {
            position: Math.min(position, total),
            duration: total,
            completed: completed || !!player.ended(),
          },
          force,
        );
    };
    const element = document.createElement("video-js");
    element.setAttribute("aria-label", `${title} · ${subtitle}`);
    container.current!.appendChild(element);
    const player = videojs(element, {
      controls: false,
      autoplay: false,
      preload: "auto",
      playsinline: true,
      muted: audioPreferences.muted,
      sources: [{ src: episode.url!, type: episode.mime! }],
    });
    playerRef.current = player;
    player.volume(audioPreferences.volume);
    const begin = () => {
      if (!active || started) return;
      // 点播等待元信息以避开源切换竞争；直播必须先 play 才开始加载分片，不能反过来等待元信息。
      const video = element.querySelector("video");
      if (!video || (!live && video.readyState < 1)) return;
      started = true;
      // 原生 Promise 不依赖播放器内部的源就绪队列，快速换集时仍只发起一次播放。
      video.play().catch((reason: Error) => {
        if (!active) return;
        if (reason.name === "AbortError") {
          setState("paused");
          setNotice("播放已中断，点击播放继续。");
          return;
        }
        if (reason.name === "NotAllowedError") {
          setState("paused");
          setNotice("点击播放，开始观看");
        } else {
          setState("error");
          setError("视频未能开始播放，请重试或更换线路。");
        }
      });
    };
    const restore = (ready = false) => {
      if (restored) return;
      const total = player.duration() || 0;
      const ranges = player.seekable();
      const plan = resolveResume(
        requestedPosition,
        total,
        Array.from({ length: ranges.length }, (_, index) => ({
          start: ranges.start(index),
          end: ranges.end(index),
        })),
      );
      if (plan.status === "restart") {
        resumeFailure = "上次位置已超出这条线路的时长，已从头开始。";
        restored = true;
        begin();
        return;
      }
      if (plan.status === "seek") {
        player.currentTime(plan.position);
        restored = true;
        begin();
        return;
      }
      if (ready) {
        restored = true;
        resumeFailure = "这个入口暂时无法恢复进度，可手动调整播放位置。";
        setNotice(resumeFailure);
        begin();
      }
    };
    player.on("loadedmetadata", () => {
      if (!active) return;
      setDuration(player.duration() || 0);
      restore();
      if (restored) begin();
      const video = element.querySelector("video");
      setPipSupported(
        !!document.pictureInPictureEnabled && !!video?.requestPictureInPicture,
      );
    });
    player.on("timeupdate", () => {
      if (active && hasPlayed && !player.error())
        lastPosition.current = player.currentTime() || 0;
      if (active) setTime(player.currentTime() || 0);
      if (active) report();
    });
    player.on("canplay", () => {
      if (active && !player.error()) {
        restore(true);
        if (restored) begin();
        if (hasPlayed && player.paused() && !player.ended()) setState("paused");
      }
    });
    player.on("durationchange", () => {
      if (active) setDuration(player.duration() || 0);
    });
    player.on("playing", () => {
      if (active && !player.error()) {
        hasPlayed = true;
        lastPosition.current = player.currentTime() || 0;
        report();
        setState("playing");
        setNotice(resumeFailure);
        reveal();
      }
    });
    player.on("pause", () => {
      if (active) {
        report(true);
        if (!player.error())
          setState(player.ended() && !live ? "ended" : "paused");
        setVisible(true);
      }
    });
    player.on("waiting", () => {
      if (active && !player.error() && !player.paused()) setState("loading");
    });
    player.on("ended", () => {
      if (active && !player.error()) {
        report(true, true);
        setState(live ? "paused" : "ended");
        setVisible(true);
        if (!live) setNotice(onEnded?.() || "本集已播完。");
      }
    });
    player.on("volumechange", () => {
      if (active) {
        setVolume(player.volume() ?? 1);
        setMuted(!!player.muted());
        onAudioChange({
          volume: player.volume() ?? 1,
          muted: !!player.muted(),
        });
      }
    });
    player.on("error", () => {
      if (active) {
        setState("error");
        setVisible(true);
        setError(
          `这个播放入口暂时不可用（${player.error()?.code ?? "未知错误"}），可重试或选择其他线路。`,
        );
      }
    });
    player.ready(() => {
      if (!active) return;
      if (restored) begin();
    });
    const onFullscreen = () =>
      setFullscreen(
        document.fullscreenElement ===
          (fullscreenTarget?.current ?? shell.current),
      );
    onFullscreen();
    document.addEventListener("fullscreenchange", onFullscreen);
    const saveOnHide = () => {
      if (document.visibilityState === "hidden") report(true);
    };
    const saveOnExit = () => report(true);
    document.addEventListener("visibilitychange", saveOnHide);
    window.addEventListener("pagehide", saveOnExit);
    shell.current?.focus();
    return () => {
      report(true);
      active = false;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("visibilitychange", saveOnHide);
      window.removeEventListener("pagehide", saveOnExit);
      playerRef.current = null;
      if (!player.isDisposed()) player.dispose();
    };
  }, [episode.id, episode.url, episode.mime, title, subtitle, attempt]);

  function togglePlayback() {
    const player = playerRef.current;
    const video = container.current?.querySelector("video");
    if (!player || !video) return;
    if (player.error()) {
      retryPlayback();
      return;
    }
    if (video.paused)
      video.play().catch((reason: Error) => {
        if (playerRef.current !== player || player.isDisposed()) return;
        if (reason.name !== "AbortError") {
          setNotice("播放未能开始，请重试");
          setState("paused");
        }
      });
    else video.pause();
    reveal();
  }
  function retryPlayback() {
    if (onRetry) onRetry();
    else setAttempt((value) => value + 1);
  }
  function seek(value: number) {
    if (live) return;
    if (!Number.isFinite(duration) || !duration) return;
    playerRef.current?.currentTime(Math.min(duration, Math.max(0, value)));
    reveal();
  }
  async function openChoices() {
    // 点播面板与视频共用全屏容器；直播仍使用原有页面外频道列表。
    if (document.fullscreenElement && !fullscreenTarget) {
      try {
        await document.exitFullscreen();
      } catch {
        setNotice("请先退出全屏，再选择其他内容。");
        setVisible(true);
        return;
      }
    }
    onEpisodes();
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        const target = fullscreenTarget?.current ?? shell.current;
        const video = container.current?.querySelector("video") as
          | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
          | null;
        if (document.fullscreenEnabled && target?.requestFullscreen)
          await target.requestFullscreen();
        else if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
        else setNotice("当前浏览器不支持全屏，可旋转手机横屏观看。");
      }
    } catch (reason) {
      setNotice(`当前浏览器未能进入全屏：${reason instanceof Error ? reason.message : "请求被拒绝"}`);
    }
    reveal();
  }
  async function togglePip() {
    try {
      if (document.pictureInPictureElement)
        await document.exitPictureInPicture();
      else
        await container.current
          ?.querySelector("video")
          ?.requestPictureInPicture();
    } catch {
      setNotice("当前视频暂时无法进入画中画");
    }
  }
  function keydown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") reveal();
    if (event.key === "Escape" && !document.fullscreenElement) {
      if (onDismissEpisodes?.()) {
        event.preventDefault();
        return;
      }
      onBack();
      return;
    }
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLButtonElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if ([" ", "k", "ArrowLeft", "ArrowRight", "m", "f"].includes(event.key))
      event.preventDefault();
    if (event.key === " " || event.key === "k") togglePlayback();
    if (event.key === "ArrowLeft") seek(time - 10);
    if (event.key === "ArrowRight") seek(time + 10);
    if (event.key === "m") playerRef.current?.muted(!muted);
    if (event.key === "f") void toggleFullscreen();
  }
  const controlsVisible = visible || state !== "playing";
  return (
    <div
      className={`cinema-player ${mobile ? "player-mobile" : "player-desktop"}`}
      data-playback-state={state}
      ref={shell}
      tabIndex={-1}
      aria-label={`${title} 播放器`}
      onKeyDown={keydown}
      onPointerMove={(event) => { if (event.pointerType === "mouse") reveal(); }}
      onFocusCapture={reveal}
      onPointerDownCapture={() => {
        tapWasVisible.current = visible || state !== "playing";
        interacting.current = true;
        reveal();
      }}
      onPointerUpCapture={() => {
        interacting.current = false;
        reveal();
      }}
      onPointerCancel={() => {
        interacting.current = false;
        reveal();
      }}
    >
      <div className="cinema-video" ref={container} data-vjs-player />
      <button
        className="cinema-tap-area"
        tabIndex={-1}
        aria-label="显示或隐藏播放控件"
        onClick={() => {
          if (state === "playing") setVisible(!tapWasVisible.current);
          else reveal();
        }}
        onDoubleClick={() => void toggleFullscreen()}
      />
      <Navigation title={title} subtitle={subtitle} onBack={onBack} live={live} visible={controlsVisible}
        onPointerEnter={(event) => {
          hoveringControls.current = event.pointerType === "mouse";
          reveal();
        }}
        onPointerLeave={() => {
          hoveringControls.current = false;
          reveal();
        }}
      />
      {state === "loading" ? (
        <div className="cinema-status" role="status">
          <LoaderCircle className="animate-spin" />
          <span>正在缓冲</span>
        </div>
      ) : null}
      {state === "error" ? (
        <div className="cinema-error" role="alert">
          <h2>暂时无法播放</h2>
          <p>{error}</p>
          <div>
            <Button onClick={retryPlayback}>
              <RotateCcw data-icon="inline-start" />
              重试
            </Button>
            <Button variant="secondary" onClick={() => void openChoices()}>
              {live ? "选择其他频道" : "更换线路"}
            </Button>
            {!live && onFindElsewhere ? (
              <Button variant="secondary" onClick={onFindElsewhere}>
                换站找片
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {state === "paused" ? (
        <button
          className="cinema-center-play"
          aria-label="播放"
          onClick={togglePlayback}
        >
          <Play fill="currentColor" />
        </button>
      ) : null}
      {state === "ended" ? (
        <section className="cinema-finished" aria-label="本集已播完">
          <h2>本集已播完</h2>
          <p role="status">{notice}</p>
          <div>
            {onNext ? <Button onClick={onNext}>播放下一集</Button> : null}
            <Button variant="secondary" onClick={() => void openChoices()}>
              选集与线路
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                playerRef.current?.currentTime(0);
                togglePlayback();
              }}
            >
              重播本集
            </Button>
          </div>
        </section>
      ) : null}
      <div
        className="cinema-controls"
        data-visible={controlsVisible}
        inert={!controlsVisible}
        onPointerEnter={(event) => {
          hoveringControls.current = event.pointerType === "mouse";
          if (timer.current) clearTimeout(timer.current);
        }}
        onPointerLeave={() => {
          hoveringControls.current = false;
          reveal();
        }}
      >
        {notice && state !== "ended" ? (
          <p className="cinema-notice" role="status">
            {notice}
          </p>
        ) : null}
        {live ? (
          <p className="live-indicator">
            <span />
            直播
          </p>
        ) : (
          <div className="cinema-timeline">
            <span>{formatTime(scrubTime ?? time)}</span>
            <input
              aria-label="播放进度"
              type="range"
              min={0}
              max={Number.isFinite(duration) && duration > 0 ? duration : 1}
              step={0.1}
              value={Math.min(scrubTime ?? time, duration || 1)}
              disabled={!Number.isFinite(duration) || !duration}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                scrubPosition.current = time;
                setScrubTime(time);
              }}
              onInput={(event) => {
                const value = Number(event.currentTarget.value);
                if (interacting.current) {
                  scrubPosition.current = value;
                  setScrubTime(value);
                }
                else seek(value);
              }}
              onPointerUp={(event) => {
                seek(scrubPosition.current ?? Number(event.currentTarget.value));
                scrubPosition.current = null;
                setScrubTime(null);
              }}
              onPointerCancel={() => {
                scrubPosition.current = null;
                setScrubTime(null);
              }}
              aria-valuetext={`${formatTime(scrubTime ?? time)}，共 ${formatTime(duration)}`}
              style={
                {
                  "--played": `${duration ? ((scrubTime ?? time) / duration) * 100 : 0}%`,
                } as React.CSSProperties
              }
            />
            <span>−{formatTime(duration - time)}</span>
          </div>
        )}
        <div className="cinema-toolbar">
          <div className="transport-controls">
            <Button
              variant="ghost"
              size="icon"
              aria-label={state === "playing" ? "暂停" : "播放"}
              onClick={togglePlayback}
            >
              {state === "playing" ? (
                <Pause fill="currentColor" />
              ) : (
                <Play fill="currentColor" />
              )}
            </Button>
            {!live ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="后退10秒"
                  onClick={() => seek(time - 10)}
                >
                  <RotateCcw />
                  <span className="skip-number">10</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="快进10秒"
                  onClick={() => seek(time + 10)}
                >
                  <RotateCw />
                  <span className="skip-number">10</span>
                </Button>
              </>
            ) : null}
            {!mobile ? <div className="volume-controls">
              <Button
                variant="ghost"
                size="icon"
                aria-label={muted ? "取消静音" : "静音"}
                onClick={() => playerRef.current?.muted(!muted)}
              >
                {muted || volume === 0 ? <VolumeX /> : <Volume2 />}
              </Button>
              <input
                aria-label="音量"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) => {
                  playerRef.current?.volume(Number(event.target.value));
                  playerRef.current?.muted(false);
                }}
              />
            </div> : null}
          </div>
          <div className="view-controls">
            <Button
              variant="ghost"
              aria-label={live ? "选择频道" : "选择集数和线路"}
              onClick={() => void openChoices()}
            >
              <ListVideo data-icon="inline-start" />
              <span>{live ? "频道" : "选集"}</span>
            </Button>
            {pipSupported && !mobile ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="画中画"
                className="cinema-pip-toggle"
                onClick={() => void togglePip()}
              >
                <PictureInPicture2 />
              </Button>
            ) : null}
            <Button
                variant="ghost"
                size="icon"
                aria-label={fullscreen ? "退出全屏" : "全屏"}
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen ? <Minimize /> : <Maximize />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
