import { useLayoutEffect, useRef } from "react";

/** 移除当前操作的卡片后，焦点顺延到相邻卡片；空列表回到浏览入口。 */
export function useRemovalFocus(ids: string[], onRemove: (id: string) => void) {
  const root = useRef<HTMLElement>(null);
  const pending = useRef<{ id: string; index: number } | null>(null);
  useLayoutEffect(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    // 保存失败会保留原卡片，此时不能把焦点转走或暗示删除成功。
    if (ids.includes(request.id)) return;
    const cards = root.current?.querySelectorAll<HTMLButtonElement>("[data-record-open]");
    const next = cards?.[Math.min(request.index, cards.length - 1)];
    const target = next ?? root.current?.querySelector<HTMLButtonElement>(".media-empty button") ?? document.querySelector<HTMLButtonElement>(".header-history");
    target?.focus({ preventScroll: true });
  });
  function remove(id: string) {
    if (root.current?.contains(document.activeElement))
      pending.current = { id, index: Math.max(0, ids.indexOf(id)) };
    onRemove(id);
  }
  return { root, remove };
}
