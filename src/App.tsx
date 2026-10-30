import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Clapperboard,
  Library,
  Clock3,
  Cloud,
  LoaderCircle,
  Play,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilmPoster } from "@/components/film-poster";
import { useViewingDevice } from "@/lib/use-viewing-device";
import { FilmDetails } from "@/components/film-details";
import { FeaturedBanner } from "@/components/featured-banner";
import { WatchHistory } from "@/components/watch-history";
import { Favorites } from "@/components/favorites";
import { useFavorites } from "@/lib/use-favorites";
import type { Favorite } from "@/lib/favorites";
import { useWatchHistory } from "@/lib/use-watch-history";
import {
  matchWatchEpisode,
  watchKey,
  type WatchRecord,
} from "@/lib/watch-history";
import { HomeCollection } from "@/components/home-collection";
import { FilmShelf } from "@/components/film-shelf";
import { EpisodePicker } from "@/components/episode-picker";
import { PlaybackOptions } from "@/components/playback-options";
import {
  decodePlaybackSettings,
  PLAYBACK_SETTINGS_KEY,
} from "@/lib/playback-settings";
import {
  matchEpisode,
  playableLines,
  matchingPosition,
  nextEpisode,
} from "@/lib/playback";
import { LibraryManager } from "@/components/library-manager";
import {
  api,
  ApiError,
  sitePath,
  type Builtin,
  type Episode,
  type Film,
  type FilmDetail,
  type FilmPage,
  type Site,
  type Subscription,
} from "@/lib/api";
import {
  DEFAULT_LIBRARY,
  PREFERENCES_KEY,
  decodeLibraryPreferences,
  emptyPreferences,
  libraryKey,
  saveCustomLibrary,
  removeCustomLibrary,
  type CustomLibrary,
  type LibraryPreferences,
  type LibrarySelection,
} from "@/lib/library-state";
import { browseHash, mediaHash, crossFilmHash } from "@/lib/browse-location";
import {
  goBack,
  navigate,
  setNavigationContext,
  useMediaRoute,
} from "@/lib/navigation";

const CrossSearchView = lazy(() => import("@/components/cross-search-view"));
const VideoPlayer = lazy(() => import("@/components/resolved-player"));
const LiveView = lazy(() => import("@/components/live-view"));
const BrowseView = lazy(() => import("@/components/browse-view"));
const CloudManager = lazy(() => import("@/components/cloud-manager"));
/** loading：正在读取内容；ready：内容可浏览；error：本次读取失败，可重试或换片库。 */
type CatalogState = "loading" | "ready" | "error";
function readPreferences() {
  try {
    return {
      preferences: decodeLibraryPreferences(
        localStorage.getItem(PREFERENCES_KEY),
      ),
      error: "",
    };
  } catch {
    return {
      preferences: emptyPreferences(),
      error: "无法恢复本机订阅设置，已打开内置片库。原始数据未在读取时覆盖。",
    };
  }
}

export default function App() {
  // false：来源原序；true：倒序展示，在本次会话的详情与播放页之间共享。
  const [episodesDescending, setEpisodesDescending] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudRevision, setCloudRevision] = useState(0);
  const mobileViewing = useViewingDevice();
  const [initial] = useState(readPreferences);
  const watchHistory = useWatchHistory();
  const favorites = useFavorites();
  const [openingFavorite, setOpeningFavorite] = useState("");
  const [failedSavedName, setFailedSavedName] = useState("");
  const [playbackSettings, setPlaybackSettings] = useState(() => {
    try {
      return {
        ...decodePlaybackSettings(localStorage.getItem(PLAYBACK_SETTINGS_KEY)),
        error: "",
      };
    } catch {
      return {
        version: 1 as const,
        autoNext: false,
        error: "自动连播设置无法读取，暂时关闭。修改开关后会重建本机设置。",
      };
    }
  });
  const playbackSettingsRef = useRef(playbackSettings);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeNotice, setResumeNotice] = useState("");
  const resumeController = useRef<AbortController | null>(null);
  const activeLibrary = useRef<Subscription | null>(null);
  const preparedFilm = useRef<{ context: string; film: FilmDetail } | null>(
    null,
  );
  const [resumeTarget, setResumeTarget] = useState<{
    context: string;
    film: FilmDetail;
    episode?: Episode;
    origin: string;
    select: boolean;
  } | null>(null);
  const [preferences, setPreferences] = useState(initial.preferences);
  const preferencesRef = useRef(preferences);
  const selection = preferences.selection;
  const customs = preferences.customs;
  const [storageError, setStorageError] = useState(initial.error);
  const lastLibraryAction = useRef<(() => void) | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [builtins, setBuiltins] = useState<Builtin[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [libraryBusy, setLibraryBusy] = useState(true);
  const [libraryError, setLibraryError] = useState("");
  const [films, setFilms] = useState<Film[]>([]);
  const homeDataScope = useRef("");
  const [homePagination, setHomePagination] =
    useState<FilmPage["pagination"]>(null);
  const [catalogState, setCatalogState] = useState<CatalogState>("loading");
  const [catalogError, setCatalogError] = useState("");
  const [sourceNotice, setSourceNotice] = useState("");
  const [detailPreview, setDetailPreview] = useState<{ context: string; film: Film } | null>(null);
  const [loadedFilm, setFilm] = useState<FilmDetail | null>(null);
  const [loadedFilmContext, setLoadedFilmContext] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [retry, setRetry] = useState(0);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const watchRoot = useRef<HTMLDivElement>(null);
  const latestPlayback = useRef<{
    film: string;
    episode: string;
    context: string;
    position: number;
  } | null>(null);
  // 切线的临时定位独立于持久历史，新线路实际播放后才写入观看记录。
  const lineResume = useRef<{
    film: string;
    episode: string;
    context: string;
    position: number;
  } | null>(null);
  // undefined 跟随正在播放的线路；数字表示缺少唯一同名集时正在浏览的目标线路索引。
  const [watchLine, setWatchLine] = useState<number | undefined>();
  const [lineNotice, setLineNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const catalogFallback = useRef({ enabled: false, tried: [] as string[] });
  const audioPreferences = useRef({ volume: 1, muted: false });
  const lastFocused = useRef<HTMLElement | null>(null);
  const browseScroll = useRef(0);
  const homeScroll = useRef(0);
  const historyScroll = useRef(0);
  const historyFocus = useRef<HTMLElement | null>(null);
  const homeFocus = useRef<HTMLElement | null>(null);
  const detailScroll = useRef(0);
  const previousWatching = useRef(false);
  const lastWatchingSelection = useRef<{ context: string; film: string; episode: string } | null>(null);
  const previousFilm = useRef("");
  const route = useMediaRoute();
  const managerOpen = route.managing;
  const libraryReturn = useRef({
    hash: "",
    source: "",
    site: "",
    snapshot: "",
    scroll: 0,
  });
  const previousManaging = useRef(false);
  function setManagerOpen(open: boolean) {
    if (open) {
      if (new URLSearchParams(location.hash.slice(1)).has("library")) return;
      libraryReturn.current = {
        hash: location.hash,
        source: libraryKey(preferencesRef.current.selection),
        site: selectedKey,
        snapshot: subscription?.revision || "",
        scroll: window.scrollY,
      };
      navigate("#library");
    } else if (new URLSearchParams(location.hash.slice(1)).has("library")) {
      const previous = libraryReturn.current;
      navigate(
        previous.source === libraryKey(preferencesRef.current.selection) &&
          previous.site === selectedKey &&
          previous.snapshot === (subscription?.revision || "") &&
          (previous.site || !/[#&](?:film|watch)=/.test(previous.hash))
          ? previous.hash
          : "",
        true,
      );
    }
  }
  const site = subscription?.sites.find((item) => item.key === selectedKey);
  const currentContext =
    subscription && site
      ? `${libraryKey(selection)}|${subscription.revision}|${site.key}`
      : "";
  const subscriptionContext = subscription
    ? `${libraryKey(selection)}|${subscription.revision}`
    : "";
  // 跨站结果归属 URL 指定站点，不改变首页与站内浏览的当前来源。
  const filmSite =
    route.crossSearching && route.filmId
      ? subscription?.sites.find(
          (item) => item.key === route.resultSite && item.supported,
        )
      : site;
  const filmContext =
    subscription && filmSite ? `${subscriptionContext}|${filmSite.key}` : "";
  useLayoutEffect(() => {
    setWatchLine(undefined);
    setLineNotice("");
    latestPlayback.current = null;
    lineResume.current = null;
  }, [filmContext, route.filmId]);
  const navigationContext = route.crossSearching
    ? subscriptionContext
    : currentContext;
  const rootTransition =
    !route.filmId &&
    (route.context === currentContext || route.context === subscriptionContext);
  const validFilmContext =
    !route.context || route.context === navigationContext || rootTransition;
  const film =
    validFilmContext &&
    loadedFilmContext === filmContext &&
    loadedFilm?.id === route.filmId
      ? loadedFilm
      : null;
  useLayoutEffect(() => {
    setNavigationContext(navigationContext);
    if (
      !(route.filmId || route.browsing || route.searching) ||
      !navigationContext
    )
      return;
    if (!validFilmContext) {
      setSourceNotice("片库或来源已改变，已返回当前浏览页，请重新选择内容。");
      navigate("", true);
    } else if (route.context !== navigationContext) {
      history.replaceState(
        { ...history.state, mediaContext: navigationContext },
        "",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [
    navigationContext,
    route.filmId,
    route.context,
    route.browsing,
    route.searching,
    validFilmContext,
  ]);

  function persistPreferences(next: LibraryPreferences, write = true) {
    preferencesRef.current = next;
    setPreferences(next);
    if (!write) return;
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError(
        "本次修改已在当前页面生效，但浏览器无法保存；刷新后可能丢失。",
      );
    }
  }
  const libraryName =
    "url" in selection
      ? customs.find((item) => item.url === selection.url)?.name ||
        subscription?.name
      : subscription?.name;

  async function loadLibrary(
    next: LibrarySelection,
    preserveRoute = false,
    draft?: CustomLibrary,
    stayOnPage = false,
  ): Promise<boolean> {
    const startedInManager = new URLSearchParams(location.hash.slice(1)).has(
      "library",
    );
    let prepared = preferencesRef.current;
    const previous = draft
      ? prepared.customs.find((item) => item.id === draft.id)
      : undefined;
    try {
      if (draft) prepared = saveCustomLibrary(prepared, draft);
    } catch (error) {
      setLibraryError((error as Error).message);
      return false;
    }
    const normalized = draft
      ? prepared.customs.find((item) => item.id === draft.id)!
      : undefined;
    if (normalized) next = { url: normalized.url };
    if (previous && normalized && previous.url === normalized.url) {
      persistPreferences(prepared);
      setLibraryError("");
      return true;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    lastLibraryAction.current = () => {
      void loadLibrary(next, preserveRoute, draft);
    };
    setLibraryBusy(true);
    setLibraryError("");
    try {
      const result = await api<Subscription>("/subscriptions", {
        method: "POST",
        body: JSON.stringify(next),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return false;
      // 编辑非当前片库只验证并保存，不改变正在浏览或播放的来源。
      if (
        previous &&
        libraryKey({ url: previous.url }) !==
          libraryKey(preferencesRef.current.selection)
      ) {
        persistPreferences(
          saveCustomLibrary(preferencesRef.current, normalized!),
        );
        void releaseLibrary(previous.url);
        return true;
      }
      const current = draft
        ? saveCustomLibrary(preferencesRef.current, normalized!)
        : preferencesRef.current;
      const key = libraryKey(next);
      const wantedSite =
        preserveRoute && libraryKey(selection) === key
          ? selectedKey || current.siteKeys[key]
          : current.siteKeys[key];
      const restored = result.sites.find(
        (item) => item.key === wantedSite && item.supported,
      );
      const nextSiteKey =
        (restored ?? result.sites.find((item) => item.supported))?.key ?? "";
      const sameSource =
        key === libraryKey(selection) && nextSiteKey === selectedKey;
      activeLibrary.current = result;
      setSubscription(result);
      setSelectedKey(nextSiteKey);
      persistPreferences(
        {
          ...current,
          selection: next,
          siteKeys: { ...current.siteKeys, [key]: nextSiteKey },
        },
        !(!subscription && preserveRoute && initial.error),
      );
      catalogFallback.current = {
        enabled:
          "builtinId" in next &&
          ["curated", "extended"].includes(next.builtinId) &&
          !route.filmId,
        tried: [],
      };
      setSourceNotice(
        preserveRoute && wantedSite && !restored
          ? "原站点已移除或不再兼容，已回到片库浏览，请重新选择影片。"
          : "",
      );
      if (
        (!preserveRoute || !sameSource) &&
        homeDataScope.current !== `${key}|${result.revision}|${nextSiteKey}`
      ) {
        setFilm(null);
        setFilms([]);
      }
      // 地址或站点身份变化后不能继续沿用旧影片编号。
      if (
        !startedInManager &&
        !stayOnPage &&
        (!preserveRoute || (subscription && !sameSource))
      )
        navigate("", true);
      if (!nextSiteKey && !startedInManager && !stayOnPage)
        setManagerOpen(true);
      if (previous && normalized && previous.url !== normalized.url)
        void releaseLibrary(previous.url);
      return true;
    } catch (error) {
      if (!controller.signal.aborted)
        setLibraryError(
          `${(error as Error).message}${subscription ? " 上次成功的片库与读取时间已保留。" : ""}`,
        );
      return false;
    } finally {
      if (request.current === controller) setLibraryBusy(false);
    }
  }
  async function releaseLibrary(url: string) {
    try {
      await api("/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ url }),
      });
    } catch {
      setStorageError("订阅已从本机列表移除，但服务暂未响应会话清理请求。");
    }
  }
  function removeLibrary(id: string) {
    const current = preferencesRef.current;
    const removed = current.customs.find((item) => item.id === id);
    if (!removed) return;
    request.current?.abort();
    setLibraryBusy(false);
    const next = removeCustomLibrary(current, id);
    const removingCurrent =
      libraryKey(next.selection) !== libraryKey(current.selection);
    persistPreferences(next);
    setLibraryError("");
    if (removingCurrent) {
      activeLibrary.current = null;
      setSubscription(null);
      setSelectedKey("");
      setFilm(null);
      setFilms([]);
      if (!managerOpen) navigate("", true);
      void loadLibrary(DEFAULT_LIBRARY);
    }
    void releaseLibrary(removed.url);
  }

  useEffect(() => {
    const controller = new AbortController();
    api<{ subscriptions: Builtin[] }>("/builtins", {
      signal: controller.signal,
    })
      .then((result) => setBuiltins(result.subscriptions))
      .catch((error) => {
        if (!controller.signal.aborted) setLibraryError(error.message);
      });
    void loadLibrary(initial.preferences.selection, true);
    return () => {
      controller.abort();
      request.current?.abort();
    };
    // 初次进入恢复一次片库；后续切换均由明确的用户操作发起。
  }, [initial]);

  useEffect(() => {
    if (!subscription || !site?.supported) return;
    const controller = new AbortController();
    setCatalogState("loading");
    setCatalogError("");
    if (homeDataScope.current !== currentContext) {
      setFilms([]);
      setHomePagination(null);
    }
    api<FilmPage>(sitePath(subscription, site), {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) {
          homeDataScope.current = currentContext;
          setFilms(result.films);
          setHomePagination(result.pagination);
          setCatalogState("ready");
          catalogFallback.current.enabled = false;
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          const fallback = catalogFallback.current;
          if (
            fallback.enabled &&
            !new URLSearchParams(location.hash.slice(1)).has("watch") &&
            !new URLSearchParams(location.hash.slice(1)).has("film") &&
            !["browse", "search", "live", "library", "history"].some((key) =>
              new URLSearchParams(location.hash.slice(1)).has(key),
            )
          ) {
            fallback.tried.push(site.key);
            const next =
              fallback.tried.length < 3
                ? subscription.sites.find(
                    (item) =>
                      item.supported && !fallback.tried.includes(item.key),
                  )
                : undefined;
            if (next) {
              setSourceNotice(`上一来源暂时不可用，已切换到${next.name}。`);
              setSelectedKey(next.key);
              return;
            }
          }
          setCatalogError(error.message);
          setCatalogState("error");
        }
      });
    return () => controller.abort();
  }, [subscription, site, retry]);

  useEffect(() => {
    if (!subscription || !filmSite || !route.filmId || !validFilmContext) {
      setFilm(null);
      if (subscription && route.filmId && !filmSite) {
        setDetailError("原来源已不可用，请返回搜索结果选择其他来源。");
        setDetailLoading(false);
      }
      return;
    }
    const prepared = preparedFilm.current;
    if (
      prepared &&
      prepared.context === filmContext &&
      prepared.film.id === route.filmId
    ) {
      preparedFilm.current = null;
      setLoadedFilmContext(filmContext);
      setFilm(prepared.film);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setFilm(null);
    setDetailError("");
    setDetailLoading(true);
    api<{ film: FilmDetail }>(
      `${sitePath(subscription, filmSite)}/${encodeURIComponent(route.filmId)}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setLoadedFilmContext(filmContext);
          setFilm(result.film);
          setDetailLoading(false);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDetailError(error.message);
          setDetailLoading(false);
        }
      });
    return () => controller.abort();
  }, [subscription, filmSite, route.filmId, detailRetry, validFilmContext]);

  const playable =
    film?.lines
      .flatMap((line) => line.episodes)
      .filter((item) => item.mime && item.url) ?? [];
  const currentRecord =
    film && filmSite
      ? watchHistory.records.find(
          (record) => record.id === watchKey(selection, filmSite.key, film.id),
        )
      : undefined;
  const historyEpisode =
    film && currentRecord && currentRecord.revision === subscription?.revision
      ? matchWatchEpisode(film, currentRecord)
      : null;
  const episode = route.episodeId
    ? playable.find((item) => item.id === route.episodeId)
    : (historyEpisode ?? playable[0]);
  const following = film && episode ? nextEpisode(film, episode.id) : undefined;
  const activePlayback = useRef("");
  activePlayback.current =
    route.watching && film && episode
      ? JSON.stringify([filmContext, film.id, episode.id])
      : "";

  // 返回详情使用刚离开的集数，不能沿用播放前父历史条目里的旧集号。
  const returnedEpisode = !route.watching && previousWatching.current &&
    lastWatchingSelection.current?.context === filmContext &&
    lastWatchingSelection.current.film === route.filmId
      ? lastWatchingSelection.current.episode : undefined;
  useLayoutEffect(() => {
    if (route.watching && route.filmId && route.episodeId)
      lastWatchingSelection.current = { context: filmContext, film: route.filmId, episode: route.episodeId };
    if (route.managing) {
      if (!previousManaging.current)
        window.scrollTo({ top: 0, behavior: "instant" });
      previousManaging.current = true;
      return;
    }
    if (previousManaging.current) {
      previousManaging.current = false;
      const previous = libraryReturn.current;
      window.scrollTo({
        top:
          previous.hash === location.hash &&
          previous.source === libraryKey(preferencesRef.current.selection)
            ? previous.scroll
            : 0,
        behavior: "instant",
      });
      previousFilm.current = route.filmId;
      previousWatching.current = route.watching;
      return;
    }
    if (route.filmId && previousFilm.current !== route.filmId)
      window.scrollTo({ top: 0, behavior: "instant" });
    if (
      route.filmId &&
      previousFilm.current === route.filmId &&
      previousWatching.current &&
      !route.watching
    ) {
      if (returnedEpisode && returnedEpisode !== route.episodeId)
        navigate(mediaHash(route.filmId, false, returnedEpisode), true);
      window.scrollTo({ top: detailScroll.current, behavior: "instant" });
    }
    if (!route.filmId && previousFilm.current) {
      window.scrollTo({
        top: browseScroll.current,
        behavior: "instant",
      });
      lastFocused.current?.focus({ preventScroll: true });
    }
    previousFilm.current = route.filmId;
    previousWatching.current = route.watching;
  }, [route.filmId, route.searching, route.watching, route.managing, route.episodeId, filmContext]);

  const surface = route.filmId
    ? "film"
    : route.managing
      ? "library"
      : route.live
        ? "live"
        : route.history
          ? "history"
          : route.searching
            ? "search"
            : route.browsing
              ? "browse"
              : "home";
  const previousSurface = useRef(surface);
  useLayoutEffect(() => {
    if (surface === "history" && previousSurface.current !== "history") {
      window.scrollTo({
        top: previousSurface.current === "film" ? historyScroll.current : 0,
        behavior: "instant",
      });
      if (previousSurface.current === "film")
        historyFocus.current?.focus({ preventScroll: true });
    }
    if (
      surface === "home" &&
      ["browse", "search", "history"].includes(previousSurface.current)
    ) {
      window.scrollTo({ top: homeScroll.current, behavior: "instant" });
      homeFocus.current?.focus({ preventScroll: true });
    }
    previousSurface.current = surface;
  }, [surface]);
  useLayoutEffect(() => {
    homeScroll.current = 0;
    homeFocus.current = null;
  }, [currentContext]);
  function captureHome(trigger?: HTMLElement) {
    if (surface === "home") {
      homeScroll.current = window.scrollY;
      homeFocus.current = trigger ?? (document.activeElement as HTMLElement);
    }
  }
  function browseHome(category = "", trigger?: HTMLElement) {
    captureHome(trigger);
    navigate(browseHash({ searching: false, query: "", category, page: 1 }));
  }
  async function resumeWatch(record: WatchRecord | Favorite) {
    const watchingRecord = "position" in record ? record : null;
    setOpeningFavorite(watchingRecord ? "" : record.id);
    setFailedSavedName("");
    if (!route.filmId) {
      browseScroll.current = window.scrollY;
      lastFocused.current = document.activeElement as HTMLElement;
    }
    if (route.history && !route.filmId) {
      historyScroll.current = window.scrollY;
      historyFocus.current = document.activeElement as HTMLElement;
    }
    resumeController.current?.abort();
    const controller = new AbortController();
    resumeController.current = controller;
    const origin = location.hash;
    setResumeBusy(true);
    setResumeNotice("");
    try {
      let loaded = activeLibrary.current;
      const same = libraryKey(selection) === libraryKey(record.selection);
      const fresh =
        loaded && Date.now() - Date.parse(loaded.fetchedAt) < 60 * 60 * 1000;
      const open = async () => {
        const pending = loadLibrary(record.selection, false, undefined, true);
        const owned = request.current;
        controller.signal.addEventListener("abort", () => owned?.abort(), {
          once: true,
        });
        const ok = await pending;
        if (!ok || controller.signal.aborted)
          throw Error("原片库未能打开，收藏和观看记录仍已保留。");
        return activeLibrary.current!;
      };
      if (!same || !fresh) loaded = await open();
      if (controller.signal.aborted) return;
      let targetSite = loaded!.sites.find(
        (item) => item.key === record.siteKey && item.supported,
      );
      if (!targetSite)
        throw Error(
          `原来源“${record.siteName}”已不可用。请选择其他片库重新查找“${record.film.name}”。`,
        );
      let result: { film: FilmDetail };
      try {
        result = await api(
          `${sitePath(loaded!, targetSite)}/${encodeURIComponent(record.film.id)}`,
          { signal: controller.signal },
        );
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 410) throw error;
        loaded = await open();
        targetSite = loaded.sites.find(
          (item) => item.key === record.siteKey && item.supported,
        );
        if (!targetSite) throw Error("原来源已移除，收藏和观看记录仍已保留。");
        result = await api(
          `${sitePath(loaded, targetSite)}/${encodeURIComponent(record.film.id)}`,
          { signal: controller.signal },
        );
      }
      if (controller.signal.aborted) return;
      let matched =
        watchingRecord && record.revision === loaded!.revision &&
        record.film.name === result.film.name
          ? matchWatchEpisode(result.film, watchingRecord)
          : null;
      if (matched && watchingRecord?.completed) {
        const episodes = result.film.lines.find(
          (line) => line.name === watchingRecord.lineName,
        )!.episodes;
        const next =
          episodes[episodes.findIndex((item) => item.id === matched!.id) + 1];
        if (next?.url && next.mime) matched = next;
      }
      const context = `${libraryKey(record.selection)}|${loaded!.revision}|${targetSite.key}`;
      setSelectedKey(targetSite.key);
      const prefs = preferencesRef.current;
      persistPreferences({
        ...prefs,
        siteKeys: {
          ...prefs.siteKeys,
          [libraryKey(record.selection)]: targetSite.key,
        },
      });
      setResumeNotice(
        !watchingRecord || matched
          ? (record.film.name !== result.film.name ? `来源返回的片名已从“${record.film.name}”变为“${result.film.name}”，请确认后播放。` : "")
          : `上次观看 ${watchingRecord.episodeName}。来源或集数已变化，请确认影片并重新选集。`,
      );
      setResumeTarget({
        context,
        film: result.film,
        episode: matched || undefined,
        origin,
        select: !!watchingRecord && !matched,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setResumeNotice(`${record.film.name}：${(error as Error).message}`);
        setFailedSavedName(record.film.name);
      }
    } finally {
      if (resumeController.current === controller) {
        resumeController.current = null;
        setResumeBusy(false);
        setOpeningFavorite("");
      }
    }
  }
  useLayoutEffect(() => {
    if (!resumeTarget || currentContext !== resumeTarget.context) return;
    preparedFilm.current = { context: currentContext, film: resumeTarget.film };
    setNavigationContext(currentContext);
    let details = mediaHash(
      resumeTarget.film.id,
      false,
      resumeTarget.episode?.id,
      resumeTarget.origin,
    );
    if (resumeTarget.select) details += "&select=1";
    setResumeTarget(null);
    setLoadedFilmContext(currentContext);
    setFilm(resumeTarget.film);
    setDetailLoading(false);
    setDetailError("");
    navigate(details);
    if (resumeTarget.episode)
      navigate(
        mediaHash(
          resumeTarget.film.id,
          true,
          resumeTarget.episode.id,
          resumeTarget.origin,
        ),
      );
  }, [resumeTarget, currentContext]);
  useEffect(() => {
    if (!route.history && !route.filmId) {
      resumeController.current?.abort();
    }
  }, [
    route.history,
    route.filmId,
    route.browsing,
    route.searching,
    route.managing,
    route.live,
  ]);
  function openFilm(item: Film, play = false, trigger?: HTMLElement) {
    const record = site
      ? watchHistory.records.find(
          (entry) => entry.id === watchKey(selection, site.key, item.id),
        )
      : undefined;
    if (play && record) {
      void resumeWatch(record);
      return;
    }
    if (!route.filmId) browseScroll.current = window.scrollY;
    lastFocused.current = trigger ?? (document.activeElement as HTMLElement);
    setDetailPreview({ context: currentContext, film: item });
    navigate(mediaHash(item.id, play));
  }
  function findSavedElsewhere(name: string) {
    resumeController.current?.abort();
    setResumeNotice("");
    setFailedSavedName("");
    navigate(browseHash({ searching: true, crossSearching: true, query: name, category: "", page: 1 }));
  }
  const favoriteId = film && filmSite ? watchKey(selection, filmSite.key, film.id) : "";
  const isFavorite = favorites.records.some(item => item.id === favoriteId);
  function toggleFavorite() {
    if (!film || !filmSite || !subscription) return;
    if (isFavorite) { favorites.remove(favoriteId); return; }
    const { id, name, poster, year, category, remarks } = film;
    favorites.add({ id: favoriteId, selection, libraryName: libraryName || subscription.name,
      revision: subscription.revision, siteKey: filmSite.key, siteName: filmSite.name,
      film: { id, name, poster, year, category, remarks }, addedAt: Date.now() });
  }
  function findElsewhere() {
    if (!film) return;
    navigate(
      browseHash({
        searching: true,
        crossSearching: true,
        query: film.name,
        category: "",
        page: 1,
      }),
    );
  }
  function openCrossFilm(source: Site, item: Film, trigger: HTMLButtonElement) {
    browseScroll.current = window.scrollY;
    lastFocused.current = trigger;
    setNavigationContext(subscriptionContext);
    navigate(crossFilmHash(route.query, source.key, item.id));
  }
  function playEpisode(item: Episode) {
    if (
      matchingPosition(
        lineResume.current,
        filmContext,
        route.filmId,
        item.id,
      ) === undefined
    )
      lineResume.current = null;
    setWatchLine(undefined);
    setLineNotice("");
    if (!route.watching) {
      detailScroll.current = window.scrollY;
      navigate(mediaHash(route.filmId, false, item.id), true);
    }
    navigate(mediaHash(route.filmId, true, item.id), route.watching);
    setEpisodesOpen(false);
  }
  function setAutoNext(autoNext: boolean) {
    let error = "";
    try {
      localStorage.setItem(
        PLAYBACK_SETTINGS_KEY,
        JSON.stringify({ version: 1, autoNext }),
      );
    } catch {
      error = "设置已在当前页面生效，但浏览器无法保存；刷新后可能丢失。";
    }
    const next = { version: 1 as const, autoNext, error };
    playbackSettingsRef.current = next;
    setPlaybackSettings(next);
  }
  function advancePlayback(automatic: boolean): string | undefined {
    if (
      !film ||
      !episode ||
      activePlayback.current !==
        JSON.stringify([filmContext, film.id, episode.id])
    )
      return;
    const actual = new URLSearchParams(location.hash.slice(1));
    if (
      actual.get("watch") !== film.id ||
      (actual.has("episode") && actual.get("episode") !== episode.id) ||
      (actual.get("scope") === "all" && actual.get("site") !== filmSite?.key)
    )
      return;
    if (following?.status === "last") return "本线路已播完。";
    if (following?.status === "unavailable")
      return `下一集「${following.episode.name}」暂不支持网页播放，请选择其他线路。`;
    if (following?.status !== "available") return "当前集已变化，请重新选择。";
    if (automatic && !playbackSettingsRef.current.autoNext)
      return "本集已播完，可手动播放下一集。";
    playEpisode(following.episode);
  }
  function changePlaybackLine(index: number) {
    if (!film || !episode) return;
    const line = playableLines(film).find((item) => item.index === index);
    if (!line) return;
    const match = matchEpisode(line.episodes, episode.name);
    if (!match) {
      setWatchLine(index);
      setLineNotice(
        "这条线路没有唯一对应集数，请选择要观看的一集。当前播放保持不变。",
      );
      return;
    }
    const position =
      matchingPosition(
        latestPlayback.current,
        filmContext,
        film.id,
        episode.id,
      ) ??
      matchingPosition(lineResume.current, filmContext, film.id, episode.id) ??
      (historyEpisode?.id === episode.id && !currentRecord?.completed
        ? currentRecord?.position || 0
        : 0);
    lineResume.current = {
      film: film.id,
      episode: match.id,
      context: filmContext,
      position,
    };
    playEpisode(match);
  }
  function openPlaybackEpisodes() {
    if (mobileViewing && !document.fullscreenElement && matchMedia("(orientation:portrait)").matches) {
      const section = watchRoot.current?.querySelector<HTMLElement>(".watch-inline-episodes");
      section?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "instant" : "smooth" });
      section?.focus({ preventScroll: true });
      return;
    }
    setEpisodesOpen(true);
  }
  function chooseSite(item: Site) {
    catalogFallback.current.enabled = false;
    setSourceNotice("");
    setSelectedKey(item.key);
    setFilm(null);
    navigate("", true);
    setManagerOpen(false);
    const current = preferencesRef.current;
    persistPreferences({
      ...current,
      siteKeys: {
        ...current.siteKeys,
        [libraryKey(current.selection)]: item.key,
      },
    });
  }
  function home() {
    homeScroll.current = 0;
    window.scrollTo({ top: 0, behavior: "instant" });
    navigate("");
  }

  return (
    <>
      <a
        className="skip-link"
        href="#content"
        onClick={(event) => {
          event.preventDefault();
          const content = document.getElementById("content");
          content?.setAttribute("tabindex", "-1");
          content?.focus({ preventScroll: true });
          content?.scrollIntoView({ block: "start", behavior: "instant" });
        }}
      >
        跳到内容
      </a>
      {!route.watching && !route.filmId ? (
        <header className="media-header">
          <button className="media-brand" onClick={home} aria-label="映场首页">
            <Clapperboard />
            <span>
              映场<span>.</span>
            </span>
          </button>
          <nav aria-label="主要导航">
            <button
              className={
                !route.searching &&
                !route.browsing &&
                !route.live &&
                !route.managing &&
                !route.history
                  ? "nav-current"
                  : ""
              }
              onClick={home}
            >
              现在观看
            </button>
            <button
              className={`nav-browse ${route.browsing ? "nav-current" : ""}`}
              onClick={(event) => browseHome("", event.currentTarget)}
            >
              浏览
            </button>
            <button
              className={route.live ? "nav-current" : ""}
              onClick={() => navigate("#live")}
            >
              直播
            </button>
            <button
              className={route.searching ? "nav-current" : ""}
              onClick={(event) => {
                captureHome(event.currentTarget);
                navigate("#search");
              }}
            >
              <Search />
              搜索
            </button>
          </nav>
          <div className="header-tools">
            <button className="header-history" aria-label="网盘登录" onClick={() => setCloudOpen(true)}><Cloud /><span>网盘</span></button>
            <button
              className="header-history"
              aria-label="我的资料库"
              aria-current={route.history && !route.filmId ? "page" : undefined}
              onClick={(event) => {
                captureHome(event.currentTarget);
                navigate("#history");
              }}
            >
              <Clock3 />
              <span>我的</span>
            </button>
            <button
              className="header-library"
              onClick={() => setManagerOpen(true)}
              aria-label="管理片库"
              aria-current={route.managing ? "page" : undefined}
            >
              <Library />
              <span>片库管理</span>
            </button>
          </div>
        </header>
      ) : null}
      <main
        id={
          route.filmId ||
          route.live ||
          route.managing ||
          route.browsing ||
          route.searching ||
          route.history
            ? undefined
            : "content"
        }
        hidden={
          !!route.filmId ||
          route.live ||
          route.managing ||
          route.browsing ||
          route.searching ||
          route.history
        }
        inert={
          !!route.filmId ||
          route.live ||
          route.managing ||
          route.browsing ||
          route.searching ||
          route.history
        }
        className={
          route.watching
            ? "media-content media-content-behind-player"
            : "media-content"
        }
      >
        {storageError ? (
          <p className="source-notice" role="status">
            {storageError}
          </p>
        ) : null}
        {libraryError && subscription ? (
          <p className="source-notice" role="alert">
            {libraryError}
          </p>
        ) : null}
        {sourceNotice && !route.filmId ? (
          <p className="source-notice" role="status">
            {sourceNotice}
          </p>
        ) : null}
        {resumeNotice ? (
          <p className="source-notice" role="status">
            {resumeNotice}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setManagerOpen(true)}
            >
              选择片库
            </Button>
          </p>
        ) : null}
        {resumeBusy ? (
          <p className="source-notice" role="status">
            正在核对上次观看的入口…
          </p>
        ) : null}
        {catalogState === "loading" &&
        films.length &&
        homeDataScope.current === currentContext ? (
          <p className="home-update-status" role="status">
            正在更新最近内容…
          </p>
        ) : null}
        <HomeCollection
          subscription={subscription}
          site={site}
          total={homePagination?.total}
          visible={
            !route.filmId &&
            !route.browsing &&
            !route.searching &&
            !route.live &&
            !route.managing &&
            !route.history
          }
          onFilm={openFilm}
          onBrowse={browseHome}
        >
          {(libraryBusy && !subscription) ||
          (catalogState === "loading" &&
            site &&
            (!films.length || homeDataScope.current !== currentContext)) ? (
            <div
              className="media-loading"
              role="status"
              aria-label="正在加载片库"
            >
              <Skeleton className="hero-skeleton" />
              <div className="loading-poster-row">
                {Array.from({ length: 6 }, (_, index) => (
                  <Skeleton key={index} className="aspect-[2/3] rounded-xl" />
                ))}
              </div>
              <span className="sr-only">正在为你打开片库</span>
            </div>
          ) : null}
          {films.length > 0 && homeDataScope.current === currentContext ? (
            <FeaturedBanner
              films={films}
              source={site?.name}
              busy={resumeBusy}
              continueIds={
                new Set(
                  watchHistory.records
                    .filter(
                      (record) =>
                        site &&
                        record.id ===
                          watchKey(selection, site.key, record.film.id) &&
                        record.revision === subscription?.revision,
                    )
                    .map((record) => record.film.id),
                )
              }
              onOpen={openFilm}
              onPlay={(item) => openFilm(item, true)}
            />
          ) : null}
          <WatchHistory
            onHistory={(trigger) => {
              captureHome(trigger);
              navigate("#history");
            }}
            records={watchHistory.records}
            busy={resumeBusy}
            error={watchHistory.error}
            onResume={(record) => void resumeWatch(record)}
            onRemove={watchHistory.remove}
            onReset={watchHistory.reset}
          />
          <Favorites records={favorites.records} error={favorites.error} writable={favorites.writable}
            onViewAll={(trigger) => { captureHome(trigger); navigate("#history&view=favorites"); }}
            openingId={openingFavorite} onOpen={(record) => void resumeWatch(record)}
            onRemove={favorites.remove} onReset={favorites.reset} onFind={findSavedElsewhere} />
          {catalogError || (libraryError && !subscription) ? (
            <section
              className={
                films.length > 0 && homeDataScope.current === currentContext
                  ? "home-refresh-error"
                  : "media-empty media-error"
              }
              role="alert"
            >
              <h2>
                {subscription && site
                  ? "最近更新暂时没有打开"
                  : "片库暂时没有打开"}
              </h2>
              <p>{catalogError || libraryError}</p>
              <div>
                <Button
                  onClick={() =>
                    subscription
                      ? setRetry((value) => value + 1)
                      : void loadLibrary(selection)
                  }
                >
                  重新加载
                </Button>
                <Button variant="outline" onClick={() => setManagerOpen(true)}>
                  换一个片库
                </Button>
              </div>
            </section>
          ) : null}
          {subscription && !site && !libraryBusy ? (
            <section className="media-empty">
              <h2>这个订阅暂时没有适用的内容</h2>
              <p>打开片库，选择内置来源，或添加另一个订阅。</p>
              <Button onClick={() => setManagerOpen(true)}>选择片库</Button>
            </section>
          ) : null}
          {homeDataScope.current === currentContext && films.length > 0 ? (
            <div className="browse-sections">
              <FilmShelf
                title="最近更新"
                subtitle={site?.name}
                films={films}
                onSelect={openFilm}
                onViewAll={(trigger) => browseHome("", trigger)}
              />
            </div>
          ) : null}
        </HomeCollection>
        {!route.watching ? (
          <footer className="media-footer">
            <span>
              映场<span className="brand-dot">.</span>
            </span>
            <button onClick={() => setManagerOpen(true)}>
              {libraryName || "选择片库"}
              <ArrowRight />
            </button>
          </footer>
        ) : null}
      </main>

      {route.history && !route.filmId ? (
        <>
          <nav className="saved-tabs" aria-label="我的资料库">
            <button aria-current={!route.favorites ? "page" : undefined} onClick={() => navigate("#history", true)}>观看记录</button>
            <button aria-current={route.favorites ? "page" : undefined} onClick={() => navigate("#history&view=favorites", true)}>我的收藏{favorites.records.length ? ` · ${favorites.records.length}` : ""}</button>
          </nav>
          {resumeBusy || resumeNotice ? <div className="saved-open-status" role="status">
            <span>{resumeBusy ? "正在核对影片入口…" : resumeNotice}</span>
            {resumeBusy ? <Button variant="ghost" onClick={() => resumeController.current?.abort()}>取消打开</Button> : null}
            {failedSavedName ? <Button variant="outline" onClick={() => findSavedElsewhere(failedSavedName)}>换站查找</Button> : null}
          </div> : null}
          {route.favorites ? <Favorites full records={favorites.records} error={favorites.error} writable={favorites.writable}
            openingId={openingFavorite} onOpen={(record) => void resumeWatch(record)}
            onRemove={favorites.remove} onReset={favorites.reset} onFind={findSavedElsewhere} /> : <WatchHistory
            full
            records={watchHistory.records}
            busy={resumeBusy}
            error={watchHistory.error}
            onResume={(record) => void resumeWatch(record)}
            onRemove={watchHistory.remove}
            onReset={watchHistory.reset}
          />}
        </>
      ) : null}
      {(route.browsing || route.searching) && !route.crossSearching ? (
        <Suspense
          fallback={
            !route.filmId ? (
              <main id="content" className="media-empty" role="status">
                正在打开片库浏览…
              </main>
            ) : null
          }
        >
          <BrowseView
            subscription={subscription}
            site={site}
            scope={currentContext}
            valid={validFilmContext}
            busy={libraryBusy}
            libraryError={libraryError}
            onLibrary={() => setManagerOpen(true)}
            onFilm={(item, trigger) => openFilm(item, false, trigger)}
          />
        </Suspense>
      ) : null}

      {route.crossSearching ? (
        <Suspense
          fallback={
            !route.filmId ? (
              <main id="content" className="media-empty" role="status">
                正在打开片库搜索…
              </main>
            ) : null
          }
        >
          <CrossSearchView
            subscription={subscription}
            scope={subscriptionContext}
            valid={validFilmContext}
            site={site}
            onLibrary={() => setManagerOpen(true)}
            onFilm={openCrossFilm}
          />
        </Suspense>
      ) : null}

      {route.live ? (
        <Suspense
          fallback={
            <main id="content" className="media-empty" role="status">
              正在打开直播…
            </main>
          }
        >
          <LiveView
            subscription={
              subscription
                ? { ...subscription, name: libraryName || subscription.name }
                : null
            }
            onLeave={home}
          />
        </Suspense>
      ) : null}

      {route.filmId && !route.watching ? (
        <main id="content">
          {resumeNotice ? (
            <p className="source-notice" role="status">
              {resumeNotice}
            </p>
          ) : null}
          <FilmDetails
            descending={episodesDescending}
            onDescendingChange={setEpisodesDescending}
            scope={filmContext}
            film={film}
            preview={detailPreview?.context === filmContext && detailPreview.film.id === route.filmId ? detailPreview.film : undefined}
            loading={detailLoading || (!film && !detailError)}
            error={detailError}
            source={filmSite?.name}
            initialEpisodeId={returnedEpisode || route.episodeId || historyEpisode?.id}
            continueEpisodeId={
              !currentRecord?.completed ? historyEpisode?.id : undefined
            }
            continuePosition={
              historyEpisode && !currentRecord?.completed
                ? currentRecord?.position
                : 0
            }
            requireSelection={route.requireSelection}
            related={filmSite?.key === site?.key ? films : []}
            onBack={goBack}
            onPlay={playEpisode}
            onRetry={() => setDetailRetry((value) => value + 1)}
            onLibrary={() => setManagerOpen(true)}
            onSelect={openFilm}
            onFindElsewhere={findElsewhere}
            favorite={isFavorite}
            favoriteError={favorites.error}
            favoriteWritable={favorites.writable}
            onFavorite={toggleFavorite}
          />
        </main>
      ) : null}

      {route.watching ? (
        <div
          className={`watch-page ${mobileViewing ? "watch-mobile" : "watch-desktop"} ${episodesOpen ? "watch-choosing" : ""}`}
          ref={watchRoot}
        >
          {(detailLoading || detailError || !film || !episode) ? (
            <Button className="cinema-back watch-back" variant="ghost" onClick={goBack}>
              <ArrowLeft /><span>返回影片</span>
            </Button>
          ) : null}
          {detailLoading ? (
            <div className="watch-loading" role="status">
              <LoaderCircle className="animate-spin" />
              <p>正在准备播放</p>
            </div>
          ) : null}
          {detailError || (film && !episode) ? (
            <div className="watch-loading">
              <h1>暂时无法播放</h1>
              <p>
                {detailError ||
                  "当前影片没有可直接播放的入口，可以换一个片库。"}
              </p>
              <Button variant="ghost" onClick={() => setManagerOpen(true)}>
                选择片库
              </Button>
            </div>
          ) : null}
          {film && episode ? (
            <Suspense
              fallback={
                <div className="watch-loading" role="status">
                  <Button className="cinema-back watch-back" variant="ghost" onClick={goBack}>
                    <ArrowLeft /><span>返回影片</span>
                  </Button>
                  <p>正在准备播放器…</p>
                </div>
              }
            >
              <VideoPlayer
                key={`${filmContext}:${film.id}:${episode.id}:${episode.platform === "quark" ? cloudRevision : ""}`}
                onCloudLogin={() => setCloudOpen(true)}
                episode={episode}
                title={film.name}
                subtitle={episode.name}
                fullscreenTarget={watchRoot}
                initialPosition={
                  matchingPosition(
                    lineResume.current,
                    filmContext,
                    film.id,
                    episode.id,
                  ) ??
                  (historyEpisode?.id === episode.id &&
                  !currentRecord?.completed
                    ? currentRecord?.position || 0
                    : 0)
                }
                onProgress={(progress, force) => {
                  latestPlayback.current = {
                    film: film.id,
                    episode: episode.id,
                    context: filmContext,
                    position: progress.position,
                  };
                  if (
                    matchingPosition(
                      lineResume.current,
                      filmContext,
                      film.id,
                      episode.id,
                    ) !== undefined
                  )
                    lineResume.current = null;
                  if (!subscription || !filmSite) return;
                  const line = film.lines.find((item) =>
                    item.episodes.some((entry) => entry.id === episode.id),
                  );
                  if (!line) return;
                  const { id, name, poster, year, category, remarks } = film;
                  watchHistory.save(
                    {
                      id: watchKey(selection, filmSite.key, film.id),
                      selection,
                      libraryName: libraryName || subscription.name,
                      revision: subscription.revision,
                      siteKey: filmSite.key,
                      siteName: filmSite.name,
                      film: { id, name, poster, year, category, remarks },
                      lineName: line.name,
                      episodeName: episode.name,
                      ...progress,
                      updatedAt: Date.now(),
                    },
                    force,
                  );
                }}
                audioPreferences={audioPreferences.current}
                onAudioChange={(audio) => {
                  audioPreferences.current = audio;
                }}
                onBack={goBack}
                onEpisodes={openPlaybackEpisodes}
                onEnded={() => advancePlayback(true)}
                onNext={
                  following?.status === "available"
                    ? () => {
                        advancePlayback(false);
                      }
                    : undefined
                }
                onDismissEpisodes={() => {
                  if (!episodesOpen) return false;
                  setEpisodesOpen(false);
                  return true;
                }}
                onFindElsewhere={findElsewhere}
              />
            </Suspense>
          ) : null}

          {mobileViewing && film && episode ? (
            <section className="watch-inline-episodes" tabIndex={-1} aria-label="当前影片与选集">
              <div className="watch-now"><p>正在观看</p><h1>{film.name}</h1><span>{episode.name} · {filmSite?.name}</span></div>
              <EpisodePicker descending={episodesDescending} onDescendingChange={setEpisodesDescending} film={film} activeId={episode.id} selectedLineIndex={watchLine} onLineChange={changePlaybackLine} notice={lineNotice} onPlay={playEpisode} />
              <PlaybackOptions autoNext={playbackSettings.autoNext} error={playbackSettings.error} onChange={setAutoNext} />
            </section>
          ) : null}
        </div>
      ) : null}
      <Dialog
        modal={false}
        open={episodesOpen && route.watching}
        onOpenChange={setEpisodesOpen}
      >
        <DialogContent
          className="watch-episodes-dialog"
          placement="edge"
          showCloseButton={false}
          portalContainer={watchRoot.current}
          data-episode-scroll
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setEpisodesOpen(false);
          }}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const panel = watchRoot.current?.querySelector<HTMLElement>(
              ".watch-episodes-dialog",
            );
            (
              panel?.querySelector<HTMLElement>('[aria-current="true"]') ??
              panel?.querySelector<HTMLElement>("[data-slot=dialog-close]")
            )?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            watchRoot.current
              ?.querySelector<HTMLElement>(".cinema-player")
              ?.focus({ preventScroll: true });
          }}
        >
          <DialogHeader>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="episode-panel-close"
                aria-label="关闭选集"
              >
                <X />
              </Button>
            </DialogClose>
            <DialogTitle>{film?.name}</DialogTitle>
            <DialogDescription>
              选择集数或线路，保留当前观看位置
            </DialogDescription>
            <PlaybackOptions
              autoNext={playbackSettings.autoNext}
              error={playbackSettings.error}
              onChange={setAutoNext}
            />
          </DialogHeader>
          {film ? (
            <EpisodePicker
              descending={episodesDescending}
              onDescendingChange={setEpisodesDescending}
              key={film.id}
              film={film}
              activeId={episode?.id}
              selectedLineIndex={watchLine}
              onLineChange={changePlaybackLine}
              notice={lineNotice}
              onPlay={playEpisode}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {cloudOpen ? <Suspense fallback={<p role="status">正在打开网盘登录…</p>}>
        <CloudManager onClose={() => setCloudOpen(false)} onChanged={() => setCloudRevision((value) => value + 1)} />
      </Suspense> : null}
      <LibraryManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        builtins={builtins}
        subscription={
          subscription
            ? { ...subscription, name: libraryName || subscription.name }
            : null
        }
        selection={selection}
        site={site}
        busy={libraryBusy}
        error={libraryError}
        customs={customs}
        onLoad={(next) => void loadLibrary(next)}
        onSite={chooseSite}
        onReload={() => void loadLibrary(selection, true)}
        onSave={(draft) => loadLibrary({ url: draft.url }, false, draft)}
        onRemove={removeLibrary}
        onRetry={() => lastLibraryAction.current?.()}
        onCancel={() => {
          request.current?.abort();
          setLibraryBusy(false);
          setLibraryError("");
          lastLibraryAction.current = null;
        }}
        storageError={storageError}
        onLive={() => {
          setManagerOpen(false);
          navigate("#live");
        }}
      />
    </>
  );
}
