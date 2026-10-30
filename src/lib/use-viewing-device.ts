import { useSyncExternalStore } from "react";

// 入口只选择页面版本；两端分别维护布局。粗指针手机横屏时仍使用手机版。
const query = "(max-width: 700px), (pointer: coarse) and (max-width: 1100px)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useViewingDevice() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
