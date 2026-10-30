import {
  libraryKey,
  subscriptionUrl,
  type LibrarySelection,
} from "./library-state.ts";
import type { Episode, Film, FilmDetail } from "./api";

export const HISTORY_KEY = "tvbox.history.v1";
export type WatchRecord = {
  id: string;
  selection: LibrarySelection;
  libraryName: string;
  revision: string;
  siteKey: string;
  siteName: string;
  film: Pick<Film, "id" | "name" | "poster" | "year" | "category" | "remarks">;
  lineName: string;
  episodeName: string;
  position: number;
  duration: number;
  /** true：当前集已播完，续看优先下一集；false：当前集未完，尝试恢复进度。 */
  completed: boolean;
  updatedAt: number;
};
export function watchKey(
  selection: LibrarySelection,
  site: string,
  film: string,
) {
  return JSON.stringify([libraryKey(selection), site, film]);
}
export function decodeHistory(raw: string | null): WatchRecord[] {
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (
    value.version !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > 100
  )
    throw Error("观看记录格式无效。");
  return value.records.map((record: WatchRecord) => {
    if (
      !record ||
      !record.selection ||
      typeof record.siteKey !== "string" ||
      !record.siteKey ||
      typeof record.siteName !== "string" ||
      typeof record.libraryName !== "string" ||
      typeof record.revision !== "string" ||
      !record.film ||
      typeof record.film.id !== "string" ||
      !record.film.id ||
      typeof record.film.name !== "string" ||
      typeof record.episodeName !== "string" ||
      typeof record.lineName !== "string"
    )
      throw Error("观看记录缺少必要信息。");
    if ("url" in record.selection) subscriptionUrl(record.selection.url);
    else if (
      typeof record.selection.builtinId !== "string" ||
      !record.selection.builtinId
    )
      throw Error("观看记录来源无效。");
    if (
      ![record.position, record.duration, record.updatedAt].every(
        Number.isFinite,
      ) ||
      record.position < 0 ||
      record.duration <= 0 ||
      record.position > record.duration + 1 ||
      record.updatedAt < 0 ||
      typeof record.completed !== "boolean"
    )
      throw Error("观看进度格式无效。");
    if (
      record.id !== watchKey(record.selection, record.siteKey, record.film.id)
    )
      throw Error("观看记录身份不一致。");
    for (const field of ["year", "category", "remarks"] as const)
      if (typeof record.film[field] !== "string")
        throw Error("影片记录格式无效。");
    if (
      record.film.poster !== null &&
      (typeof record.film.poster !== "string" ||
        !/^https?:\/\//.test(record.film.poster) ||
        !URL.canParse(record.film.poster))
    )
      throw Error("影片海报地址无效。");
    return record;
  });
}
export function saveWatchRecord(records: WatchRecord[], record: WatchRecord) {
  return [record, ...records.filter((item) => item.id !== record.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 100);
}
export function matchWatchEpisode(
  film: FilmDetail,
  record: WatchRecord,
): Episode | null {
  const lines = film.lines.filter((line) => line.name === record.lineName);
  if (lines.length !== 1) return null;
  const episodes = lines[0].episodes.filter(
    (episode) =>
      episode.name === record.episodeName && episode.mime && episode.url,
  );
  return episodes.length === 1 ? episodes[0] : null;
}
export function watchPercent(record: WatchRecord) {
  return Math.min(100, Math.round((record.position / record.duration) * 100));
}
export function watchTime(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}:` : ""}${hours ? String(minutes).padStart(2, "0") : minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
