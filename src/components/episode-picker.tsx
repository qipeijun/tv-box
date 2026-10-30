import { useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import type { Episode, FilmDetail } from "@/lib/api";
import { playableLines } from "@/lib/playback";

import { episodeGroups } from "@/lib/episode-groups";
export function EpisodePicker({
  film,
  activeId,
  onPlay,
  selectedLineIndex,
  onLineChange,
  notice,
  showFullName = false,
  descending,
  onDescendingChange,
  activeLabel = "正在播放",
}: {
  film: FilmDetail;
  activeId?: string;
  onPlay: (episode: Episode) => void;
  selectedLineIndex?: number;
  onLineChange?: (index: number) => void;
  notice?: string;
  /** PC 详情展示完整集名；紧凑播放面板可将标准集名缩写为数字。 */
  showFullName?: boolean;
  /** false：来源原序；true：倒序展示，均不修改自动连播集序。 */
  descending: boolean;
  onDescendingChange: (value: boolean) => void;
  activeLabel?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const lines = playableLines(film);
  const initialLine =
    lines.find((line) =>
      line.episodes.some((episode) => episode.id === activeId),
    ) ?? lines[0];
  // 手动浏览只属于当前集；实际切集后立即跟随新集所在的线路和分组。
  const selectionKey = `${film.id}|${activeId || ""}`;
  const [localLine, setLocalLine] = useState({
    key: selectionKey,
    index: initialLine?.index,
  });
  const [group, setGroup] = useState({ key: "", index: 0 });
  const line =
    lines.find(
      (item) =>
        item.index ===
        (selectedLineIndex ??
          (localLine.key === selectionKey
            ? localLine.index
            : initialLine?.index)),
    ) ?? lines[0];
  const activeIndex =
    line?.episodes.findIndex((episode) => episode.id === activeId) ?? -1;
  const displayGroups = episodeGroups(line?.episodes ?? [], descending);
  const groups = displayGroups.length;
  const activeGroupIndex = displayGroups.findIndex((item) =>
    item.episodes.some((episode) => episode.id === activeId),
  );
  const groupKey = `${selectionKey}|${line?.index}|${descending}`;
  const currentGroup = Math.min(
    group.key === groupKey
      ? group.index
      : Math.max(0, activeGroupIndex),
    Math.max(0, groups - 1),
  );
  useLayoutEffect(() => {
    const current = root.current?.querySelector<HTMLElement>(
      '[aria-current="true"]',
    );
    const scroll = root.current?.closest<HTMLElement>("[data-episode-scroll]");
    // 只调整面板自身，不让详情首屏或手机视频被选集自动滚走。
    if (current && scroll) {
      const top =
        current.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        scroll.scrollTop;
      if (
        top < scroll.scrollTop ||
        top + current.offsetHeight > scroll.scrollTop + scroll.clientHeight
      )
        scroll.scrollTop = Math.max(0, top - scroll.clientHeight / 2);
    }
  }, [activeId, currentGroup, line?.index, descending]);
  if (!line) return null;
  const names = new Map<string, number>();
  const ordinals = new Map<string, number>();
  for (const item of line.episodes) {
    const ordinal = (names.get(item.name) || 0) + 1;
    names.set(item.name, ordinal);
    ordinals.set(item.id, ordinal);
  }
  const episodes = displayGroups[currentGroup].episodes;
  const longNames = line.episodes.some((episode) =>
    !/^第\s*\d+\s*[集期话]$|^\d{1,3}$/.test(episode.name),
  );
  function changeOrder(next: boolean) {
    if (next === descending) return;
    onDescendingChange(next);
    // 用户切换排序时从首组浏览；定位当前集由独立操作承担。
    setGroup({ key: `${selectionKey}|${line?.index}|${next}`, index: 0 });
  }
  return (
    <section
      className="episodes episode-picker"
      data-long-names={longNames || undefined}
      data-full-name={showFullName || undefined}
      aria-label="选择集数"
      ref={root}
    >
      <div className="episodes-heading">
        <h2>
          选集<span>{line.episodes.length} 集</span>
        </h2>
        <div className="episode-heading-controls">
        {activeIndex >= 0 ? (
          <span className="episode-playing">
            {activeLabel} · {line.episodes[activeIndex].name}
          </span>
        ) : null}
        {activeGroupIndex >= 0 && activeGroupIndex !== currentGroup ? (
          <button className="episode-locate" onClick={() => setGroup({ key: groupKey, index: activeGroupIndex })}>
            定位{activeLabel === "正在播放" ? "当前集" : activeLabel}
          </button>
        ) : null}
        <div className="episode-order" role="group" aria-label="集数排序">
          <button aria-pressed={!descending} onClick={() => changeOrder(false)}>正序</button>
          <button aria-pressed={descending} onClick={() => changeOrder(true)}>倒序</button>
        </div>
        </div>
      </div>
      {lines.length > 1 ? (
        <ToggleGroup.Root
          type="single"
          className="episode-line-tabs"
          aria-label="播放线路"
          value={String(line.index)}
          onValueChange={(value) => {
            if (!value) return;
            const next = Number(value);
            if (onLineChange) onLineChange(next);
            else setLocalLine({ key: selectionKey, index: next });
          }}
        >
          {lines.map((item, index) => (
            <ToggleGroup.Item
              key={item.index}
              value={String(item.index)}
              title={item.name}
            >
              {item.name || `线路 ${index + 1}`}
              <span>{item.episodes.length} 集</span>
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      ) : null}
      {notice ? (
        <p className="episode-notice" role="status">
          {notice}
        </p>
      ) : null}
      {groups > 1 ? (
        <div className="episode-group-navigation">
          <button aria-label="上一组选集" disabled={currentGroup === 0}
            onClick={() => setGroup({ key: groupKey, index: currentGroup - 1 })}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <select aria-label="集数范围" value={currentGroup}
            onChange={(event) => setGroup({ key: groupKey, index: Number(event.target.value) })}>
            {displayGroups.map((item, index) => (
              <option key={item.label} value={index}>{item.label} 集 · 第 {index + 1}/{groups} 组</option>
            ))}
          </select>
          <button aria-label="下一组选集" disabled={currentGroup === groups - 1}
            onClick={() => setGroup({ key: groupKey, index: currentGroup + 1 })}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <div className="episode-tiles">
        {episodes.map((episode) => {
          const number = episode.name.match(/^第\s*(\d+)\s*[集期话]$/)?.[1];
          const current = episode.id === activeId;
          const duplicate = (names.get(episode.name) || 0) > 1;
          return (
            <button
              key={episode.id}
              className="episode-tile"
              aria-current={current ? "true" : undefined}
              aria-label={`${episode.name}${duplicate ? `，条目 ${ordinals.get(episode.id)}` : ""}${current ? `，${activeLabel}` : ""}`}
              title={episode.name}
              onClick={() => onPlay(episode)}
            >
              {current ? (
                <Play className="episode-current-icon" aria-hidden="true" />
              ) : null}
              <span>
                <span className="episode-name">{showFullName ? episode.name : number || episode.name}</span>
                {duplicate ? (
                  <small className="episode-duplicate">
                    条目 {ordinals.get(episode.id)}
                  </small>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
