import type { FilmMetadata, MetadataProvider } from "./api";

export const METADATA_KEY = "tvbox.metadata.v1";
export type MetadataMatch = { key: string; provider: MetadataProvider; id: string };

export function decodeMetadataMatches(raw: string | null): MetadataMatch[] {
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (!data || data.version !== 1 || !Array.isArray(data.matches) || data.matches.length > 100 || data.matches.some((item: MetadataMatch) =>
    !item || typeof item.key !== "string" || !item.key || typeof item.id !== "string" || item.id.length > 24 ||
    !(item.provider === "cinemeta" ? /^tt\d+$/.test(item.id) : item.provider === "tvmaze" && /^[1-9]\d*$/.test(item.id)))) {
    throw Error("本机影片资料匹配记录格式无效，请重新确认资料。");
  }
  return data.matches;
}

/** 仅自动采用片名和年份均一致的唯一候选；跨语言、无年份或同名版本由用户确认。 */
export function exactMetadata(candidates: FilmMetadata[], name: string, year: string) {
  if (!/^\d{4}$/.test(year)) return null;
  const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
  const matches = candidates.filter((item) => normalize(item.name) === normalize(name) && item.year === year);
  return matches.length === 1 ? matches[0] : null;
}
