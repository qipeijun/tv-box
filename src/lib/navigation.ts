import { useSyncExternalStore } from "react";
import {
  browseHash,
  mediaHash,
  readBrowseLocation,
} from "./browse-location.ts";

let mediaContext = "";
/** 为后续历史条目附带片库、站点与配置快照身份，防止跨来源复用影片编号。 */
export function setNavigationContext(value: string) {
  mediaContext = value;
}

/** 用浏览器历史保留详情、播放与返回关系，片库内容不会因打开详情而卸载。 */
export function navigate(hash: string, replace = false) {
  window.history[replace ? "replaceState" : "pushState"](
    // 替换深链的集数不会凭空建立父页面，返回不能因此跳出应用。
    { mediaApp: !replace || history.state?.mediaApp === true, mediaContext },
    "",
    hash || `${location.pathname}${location.search}`,
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function goBack() {
  if (history.state?.mediaApp) history.back();
  else {
    const params = new URLSearchParams(location.hash.slice(1));
    // 直接打开的详情或播放链接也有明确父级，不依赖不存在的站内历史。
    if (params.has("watch"))
      navigate(
        mediaHash(
          params.get("watch")!,
          false,
          params.get("episode") || undefined,
        ),
        true,
      );
    else if (params.has("browse") || params.has("search"))
      navigate(browseHash(readBrowseLocation(params)), true);
    else if (params.has("history")) navigate(params.get("view") === "favorites" ? "#history&view=favorites" : "#history", true);
    else navigate("", true);
  }
}

let cachedLocation: { hash: string; context: string } | undefined;
function readLocation() {
  const context =
    typeof history.state?.mediaContext === "string"
      ? (history.state.mediaContext as string)
      : "";
  if (
    !cachedLocation ||
    cachedLocation.hash !== location.hash ||
    cachedLocation.context !== context
  )
    cachedLocation = { hash: location.hash, context };
  return cachedLocation;
}
function subscribeLocation(change: () => void) {
  window.addEventListener("popstate", change);
  window.addEventListener("hashchange", change);
  return () => {
    window.removeEventListener("popstate", change);
    window.removeEventListener("hashchange", change);
  };
}

export function useMediaRoute() {
  // 多个页面共享同一浏览器快照，避免父页恢复焦点时子页还处于隐藏状态。
  const current = useSyncExternalStore(subscribeLocation, readLocation);
  const params = new URLSearchParams(current.hash.slice(1));
  return {
    ...readBrowseLocation(params),
    context: current.context,
    resultSite: params.get("site") || "",
    filmId: params.get("watch") || params.get("film") || "",
    episodeId: params.get("episode"),
    watching: params.has("watch"),
    searching: params.has("search"),
    browsing: params.has("browse"),
    history: params.has("history"),
    favorites: params.has("history") && params.get("view") === "favorites",
    requireSelection: params.get("select") === "1",
    live: params.has("live"),
    managing: params.has("library"),
    libraryView: params.get("view") || "list",
  };
}
