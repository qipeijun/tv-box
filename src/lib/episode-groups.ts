import type { Episode } from "./api";

/** 只反转展示分组及组内顺序，保留来源集序、集数对象和固定范围。 */
export function episodeGroups(episodes: Episode[], descending: boolean) {
  const groups = [];
  for (let start = 0; start < episodes.length; start += 30) {
    const end = Math.min(start + 30, episodes.length);
    const items = episodes.slice(start, end);
    groups.push({
      label: descending ? `${end}–${start + 1}` : `${start + 1}–${end}`,
      episodes: descending ? items.reverse() : items,
    });
  }
  return descending ? groups.reverse() : groups;
}
