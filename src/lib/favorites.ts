import { watchKey, type WatchRecord } from './watch-history.ts';
import { subscriptionUrl } from './library-state.ts';

export const FAVORITES_KEY = 'tvbox.favorites.v1';
export const FAVORITES_LIMIT = 500;
/** 收藏保存影片与来源快照，不保存易失的媒体地址或观看进度。 */
export type Favorite = Pick<WatchRecord, 'id' | 'selection' | 'libraryName' | 'revision' | 'siteKey' | 'siteName' | 'film'> & { addedAt: number };

export function decodeFavorites(raw: string | null): Favorite[] {
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (!value || value.version !== 1 || !Array.isArray(value.records) || value.records.length > FAVORITES_LIMIT)
    throw Error('收藏格式无效。');
  const identities = new Set<string>();
  for (const record of value.records) {
    if (!record || !record.selection || typeof record.selection !== 'object' ||
      typeof record.siteKey !== 'string' || !record.siteKey ||
      typeof record.siteName !== 'string' || typeof record.libraryName !== 'string' ||
      typeof record.revision !== 'string' || !Number.isFinite(record.addedAt) || record.addedAt < 0 ||
      !record.film || typeof record.film.id !== 'string' || !record.film.id ||
      typeof record.film.name !== 'string' || !record.film.name)
      throw Error('收藏缺少必要信息。');
    if ('url' in record.selection) subscriptionUrl(record.selection.url);
    else if (typeof record.selection.builtinId !== 'string' || !record.selection.builtinId)
      throw Error('收藏来源无效。');
    for (const field of ['year', 'category', 'remarks'])
      if (typeof record.film[field] !== 'string') throw Error('收藏影片信息无效。');
    if (record.film.poster !== null && (typeof record.film.poster !== 'string' ||
      !/^https?:\/\//.test(record.film.poster) || !URL.canParse(record.film.poster)))
      throw Error('收藏海报地址无效。');
    if (record.id !== watchKey(record.selection, record.siteKey, record.film.id) || identities.has(record.id))
      throw Error('收藏身份重复或不一致。');
    identities.add(record.id);
  }
  return value.records;
}

/** 添加是幂等操作；不同站点同名影片保持独立。达到上限时不静默移除旧收藏。 */
export function addFavorite(records: Favorite[], record: Favorite) {
  if (records.some(item => item.id === record.id)) return records;
  if (records.length >= FAVORITES_LIMIT) throw Error(`最多收藏 ${FAVORITES_LIMIT} 部影片，请先移除部分收藏。`);
  return [record, ...records];
}
