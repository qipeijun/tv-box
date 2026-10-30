import { useRemovalFocus } from "@/lib/use-removal-focus";
import { useState } from "react";
import { ArrowLeft, Clock3, Play, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { FilmPoster } from "./film-poster";
import { navigate } from "@/lib/navigation";
import { watchPercent, watchTime, type WatchRecord } from "@/lib/watch-history";
export function WatchHistory({
  records,
  full = false,
  busy = false,
  error,
  onResume,
  onRemove,
  onReset,
  onHistory,
}: {
  records: WatchRecord[];
  full?: boolean;
  busy?: boolean;
  error: string;
  onResume: (record: WatchRecord) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
  onHistory?: (trigger: HTMLButtonElement) => void;
}) {
  const [resetting, setResetting] = useState(false);
  const items = full ? records : records.slice(0, 12);
  const { root, remove } = useRemovalFocus(items.map(record => record.id), onRemove);
  const cards = (
    <>
      {error ? (
        <p className="history-notice" role="status">
          {error}
        </p>
      ) : null}
      <div className={full ? "history-grid" : "history-rail"}>
        {items.map((record) => (
          <article className="history-card" key={record.id}>
            <button
              data-record-open
              className="history-resume"
              disabled={busy}
              onClick={() => onResume(record)}
              aria-label={`${record.completed ? "接着看" : "继续观看"}${record.film.name} ${record.episodeName}`}
            >
              <div className="history-art">
                <FilmPoster
                  key={record.film.poster}
                  url={record.film.poster}
                  name={record.film.name}
                />
                <span className="history-play">
                  <Play fill="currentColor" />
                </span>
                <div
                  className="history-progress"
                  role="progressbar"
                  aria-label={`${record.film.name}观看进度`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={watchPercent(record)}
                >
                  <span style={{ width: `${watchPercent(record)}%` }} />
                </div>
              </div>
              <h3>{record.film.name}</h3>
              <p>
                {record.episodeName} ·{" "}
                {record.completed
                  ? "已看完"
                  : `已看 ${watchTime(record.position)}`}
              </p>
              <small>{record.siteName}</small>
            </button>
            <Button
              className="history-remove"
              variant="ghost"
              size="icon"
              aria-label={`移除${record.film.name}的观看记录`}
              disabled={busy}
              onClick={() => remove(record.id)}
            >
              <Trash2 />
            </Button>
          </article>
        ))}
      </div>
    </>
  );
  if (full)
    return (
      <main ref={root} id="content" className="history-page">
        <Button variant="ghost" onClick={() => navigate("")}>
          <ArrowLeft />
          现在观看
        </Button>
        <header>
          <p>从离开的地方继续。</p>
          <h1>观看记录</h1>
        </header>
        {cards}
        {!records.length ? (
          <section className="media-empty">
            <Clock3 />
            <h2>还没有观看记录</h2>
            <p>开始播放后，会记住影片、集数和进度。</p>
            <Button onClick={() => navigate("#browse")}>找一部想看的</Button>
          </section>
        ) : null}
        {error ? (
          resetting ? (
            <div className="history-notice">
              <p>将清空此浏览器的全部观看记录，重新开始保存。</p>
              <Button
                variant="outline"
                onClick={() => {
                  onReset();
                  setResetting(false);
                }}
              >
                清空并重建
              </Button>
              <Button variant="ghost" onClick={() => setResetting(false)}>
                取消
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setResetting(true)}>
              重置本机观看记录
            </Button>
          )
        ) : null}
      </main>
    );
  if (!items.length && !error) return null;
  return (
    <section ref={root} className="continue-watching" aria-label="继续观看">
      <div className="shelf-heading">
        <div>
          <h2>继续观看</h2>
          <p>接着上次，继续你的故事。</p>
        </div>
        <Button
          variant="ghost"
          onClick={(event) =>
            onHistory ? onHistory(event.currentTarget) : navigate("#history")
          }
        >
          全部记录
        </Button>
      </div>
      {cards}
    </section>
  );
}
