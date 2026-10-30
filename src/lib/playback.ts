import type { Episode, FilmDetail } from "./api";

export type PlaybackPosition = {
  context: string;
  film: string;
  episode: string;
  position: number;
};

/** 只在来源、影片与集数全部一致时沿用秒数；0 是有效进度。 */
export function matchingPosition(
  value: PlaybackPosition | null,
  context: string,
  film: string,
  episode: string,
) {
  return value?.context === context &&
    value.film === film &&
    value.episode === episode &&
    Number.isFinite(value.position) &&
    value.position >= 0
    ? value.position
    : undefined;
}

/** wait：媒体尚不能定位；seek：目标处于可定位区间；restart：旧进度已超出新媒体时长。 */
export type ResumePlan =
  | { status: "wait" }
  | { status: "seek"; position: number }
  | { status: "restart" };

/** 不把超出时长的旧进度夹到片尾，也不把尚不可定位冒充定位成功。 */
export function resolveResume(
  position: number,
  duration: number,
  ranges: { start: number; end: number }[],
): ResumePlan {
  if (!Number.isFinite(duration) || duration <= 0) return { status: "wait" };
  if (position >= duration) return { status: "restart" };
  return ranges.some(
    (range) => position >= range.start && position <= range.end,
  )
    ? { status: "seek", position }
    : { status: "wait" };
}

/** 只提供已识别的可播放入口，保留源线路和集数顺序。 */
export function playableLines(film: FilmDetail) {
  return film.lines
    .map((line, index) => ({
      ...line,
      index,
      episodes: line.episodes.filter((episode) => episode.mime && episode.url),
    }))
    .filter((line) => line.episodes.length);
}

/** 切线仅在同名集唯一时匹配，避免集数缺失或重复时误播。 */
export function matchEpisode(
  episodes: Episode[],
  name: string,
): Episode | null {
  const matches = episodes.filter((episode) => episode.name === name);
  return matches.length === 1 ? matches[0] : null;
}

/** 将真实观看秒数用于按钮与续播提示，不将影片资料时长当作播放进度。 */
export function playbackTime(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** available：同线路下一项可播放；last：当前为末集；unavailable：紧邻下一项不可播放；missing：当前集不在该影片。 */
export type NextEpisode =
  | { status: "available"; episode: Episode }
  | { status: "last" }
  | { status: "unavailable"; episode: Episode }
  | { status: "missing" };
/** 严格遵循源返回的当前线路集序，不排序、不跳过不可播放集、不跨线。 */
export function nextEpisode(film: FilmDetail, currentId: string): NextEpisode {
  const line = film.lines.find((line) =>
    line.episodes.some((episode) => episode.id === currentId),
  );
  if (!line) return { status: "missing" };
  const index = line.episodes.findIndex((episode) => episode.id === currentId);
  const next = line.episodes[index + 1];
  if (!next) return { status: "last" };
  return {
    status: next.url && next.mime ? "available" : "unavailable",
    episode: next,
  };
}
