import { useEffect, useRef, useState, type ComponentProps } from "react";
import VideoPlayer from "./video-player";
import { api, type Episode } from "@/lib/api";

/** 仅解析当前选中的集数；切集或离开后取消请求，迟到地址不能应用到新集。 */
export default function ResolvedPlayer({ onCloudLogin, ...props }: ComponentProps<typeof VideoPlayer> & { onCloudLogin?: () => void }) {
  const { episode } = props;
  const [result, setResult] = useState<{ key: Episode; media?: Episode; error?: string }>();
  const [retry, setRetry] = useState(0);
  const resume = useRef(props.initialPosition ?? 0);
  useEffect(() => {
    if (!episode.needsResolve || !episode.url) return;
    const controller = new AbortController();
    setResult(undefined);
    const [line, index] = episode.id.split(":").map(Number);
    api<{ url: string; mime: string }>(episode.url.replace(/^\/api/, ""), {
      method: "POST", signal: controller.signal, body: JSON.stringify({ line, episode: index }),
    }).then((media) => {
      if (!controller.signal.aborted) setResult({ key: episode, media: { ...episode, ...media, needsResolve: false } });
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setResult({ key: episode, error: error.message });
    });
    return () => controller.abort();
  }, [episode, retry]);
  if (!episode.needsResolve) return <VideoPlayer {...props} />;
  const current = result?.key === episode ? result : undefined;
  if (current?.media) return <VideoPlayer {...props} episode={current.media} initialPosition={resume.current}
    onProgress={(progress, force) => { resume.current = progress.position; props.onProgress?.(progress, force); }}
    onRetry={() => { setResult(undefined); setRetry((value) => value + 1); }} />;
  return <div className="watch-loading" role="status">
    <button type="button" className="cinema-back watch-back" onClick={props.onBack}>返回影片</button>
    <p>{current?.error ?? "正在解析当前集的播放地址…"}</p>
    <button type="button" onClick={props.onEpisodes}>选集与线路</button>
    {current?.error && <button type="button" onClick={() => setRetry((value) => value + 1)}>重试解析</button>}
    {current?.error && episode.platform === "quark" && <button type="button" onClick={onCloudLogin}>网盘登录</button>}
  </div>;
}
