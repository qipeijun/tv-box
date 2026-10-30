import { useEffect, useRef, useState } from 'react';
import { addFavorite, decodeFavorites, FAVORITES_KEY, type Favorite } from './favorites';
function readFavorites() {
  try {
    return { records: decodeFavorites(localStorage.getItem(FAVORITES_KEY)), error: '', writable: true };
  } catch {
    return { records: [] as Favorite[], error: '收藏无法读取，原始数据已保留。可在我的收藏中重建。', writable: false };
  }
}
export function useFavorites() {
  const [state, setState] = useState(readFavorites);
  const current = useRef(state);
  function update(next: typeof state) { current.current = next; setState(next); }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === FAVORITES_KEY || event.key === null) update(readFavorites());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function change(id: string, record?: Favorite) {
    let records: Favorite[];
    try {
      // 操作前读取最新值，避免两个标签页先后收藏时覆盖对方的记录。
      records = decodeFavorites(localStorage.getItem(FAVORITES_KEY));
    } catch {
      update({ ...current.current, writable: false, error: '收藏无法读取，原始数据已保留。请在我的收藏中重建。' });
      return;
    }
    try {
      const next = record ? addFavorite(records, record) : records.filter(item => item.id !== id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify({ version: 1, records: next }));
      update({ records: next, error: '', writable: true });
    } catch (reason) {
      const error = reason as Error;
      const message = error.name === "QuotaExceededError" ? "浏览器存储空间不足，请移除部分收藏后重试。" : error.name === "SecurityError" ? "浏览器不允许保存收藏，请检查存储权限。" : error.message;
      update({ ...current.current, error: `收藏未保存：${message}`, writable: current.current.writable });
    }
  }
  function reset() {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify({version: 1, records: []}));
      update({ records: [], error: '', writable: true });
    } catch { update({ ...current.current, error: '浏览器未能重建收藏，请检查存储空间或权限。' }); }
  }
  return { ...state, add: (record: Favorite) => change(record.id, record), remove: (id: string) => change(id), reset };
}
