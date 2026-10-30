import { useEffect, useRef, useState } from "react";
import {
  decodeHistory,
  HISTORY_KEY,
  saveWatchRecord,
  type WatchRecord,
} from "./watch-history";
function initialHistory() {
  try {
    return {
      records: decodeHistory(localStorage.getItem(HISTORY_KEY)),
      error: "",
      writable: true,
    };
  } catch {
    return {
      records: [] as WatchRecord[],
      error: "观看记录无法读取。新进度暂存当前页面，原始记录未覆盖。",
      writable: false,
    };
  }
}
export function useWatchHistory() {
  const [state, setState] = useState(initialHistory);
  const current = useRef(state);
  current.current = state;
  const lastSave = useRef({ id: "", at: 0 });
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== HISTORY_KEY) return;
      const next = initialHistory();
      current.current = next;
      setState(next);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  function commit(records: WatchRecord[]) {
    let next = { ...current.current, records };
    if (next.writable) {
      try {
        localStorage.setItem(
          HISTORY_KEY,
          JSON.stringify({ version: 1, records }),
        );
        next.error = "";
      } catch {
        next.writable = false;
        next.error = "浏览器未能保存观看记录，当前进度暂存本页。";
      }
    }
    current.current = next;
    setState(next);
  }
  function latest() {
    if (!current.current.writable) return current.current.records;
    try {
      return decodeHistory(localStorage.getItem(HISTORY_KEY));
    } catch {
      current.current = {
        ...current.current,
        writable: false,
        error: "观看记录无法读取。新进度暂存当前页面，原始记录未覆盖。",
      };
      return current.current.records;
    }
  }
  function save(record: WatchRecord, force = false) {
    const now = Date.now();
    const identity = JSON.stringify([
      record.id,
      record.lineName,
      record.episodeName,
    ]);
    if (
      !force &&
      lastSave.current.id === identity &&
      now - lastSave.current.at < 5000
    )
      return;
    lastSave.current = { id: identity, at: now };
    commit(saveWatchRecord(latest(), record));
  }
  function remove(id: string) {
    commit(latest().filter((record) => record.id !== id));
  }
  function reset() {
    const next = { records: [], error: "", writable: true };
    current.current = next;
    setState(next);
    commit([]);
  }
  return {
    records: state.records,
    error: state.error,
    writable: state.writable,
    save,
    remove,
    reset,
  };
}
