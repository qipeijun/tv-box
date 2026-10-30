import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Search } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FilmPoster } from "./film-poster";
import { SearchScope } from "./search-scope";
import {
  api,
  sitePath,
  type Film,
  type FilmPage,
  type Site,
  type Subscription,
} from "@/lib/api";
import { browseHash } from "@/lib/browse-location";
import { navigate, useMediaRoute } from "@/lib/navigation";
import { createCrossSearch, type SearchSnapshot } from "@/lib/cross-search";
type Results = SearchSnapshot & { key: string; query: string };
export default function CrossSearchView({
  subscription,
  scope,
  valid,
  site,
  onLibrary,
  onFilm,
}: {
  subscription: Subscription | null;
  scope: string;
  valid: boolean;
  site?: Site;
  onLibrary: () => void;
  onFilm: (site: Site, film: Film, trigger: HTMLButtonElement) => void;
}) {
  const route = useMediaRoute();
  const visible = !route.filmId && !route.live && !route.managing;
  const key = `${scope}|${route.query}`;
  const eligible =
    subscription?.sites.filter(
      (source) => source.supported && source.searchable,
    ).length || 0;
  const [statusOpen, setStatusOpen] = useState(false);
  const [draft, setDraft] = useState(route.query);
  const [value, setValue] = useState<Results | null>(null);
  const [previous, setPrevious] = useState<Results | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const cache = useRef<Results | null>(null);
  const engine = useRef<ReturnType<typeof createCrossSearch> | null>(null);
  const scroll = useRef(0);
  const previousVisible = useRef(false);
  const current = value?.key === key ? value : null;
  const pending = current
    ? current.groups.filter(
        (group) => group.status === "queued" || group.status === "loading",
      ).length
    : valid && route.query.trim() && !route.error
      ? eligible
      : 0;
  const hasResults = current?.groups.some((group) => group.data?.films.length);
  const fallback = value?.key !== key ? value : previous;
  const retained =
    !!route.query.trim() &&
    !route.error &&
    valid &&
    fallback?.key.startsWith(`${scope}|`)
      ? fallback
      : null;
  const display =
    current && (hasResults || !pending) ? current : retained || current;
  const stale = !!display && display.key !== key;
  useEffect(() => setDraft(route.query), [route.query]);
  useEffect(() => setCounts({}), [key]);
  useEffect(() => {
    if (
      !subscription ||
      !visible ||
      !valid ||
      route.error ||
      !route.query.trim()
    )
      return;
    const seed = cache.current?.key === key ? cache.current : undefined;
    if (!seed && cache.current) setPrevious(cache.current);
    const owned = createCrossSearch(
      subscription.sites,
      (source, page, signal) =>
        api<FilmPage>(
          `${sitePath(subscription, source)}?search=${encodeURIComponent(route.query.trim())}&page=${page}`,
          { signal },
        ),
      (next) => {
        const result = { ...next, key, query: route.query };
        cache.current = result;
        setValue(result);
      },
      seed,
    );
    engine.current = owned;
    return () => {
      owned.stop();
      if (engine.current === owned) engine.current = null;
    };
  }, [key, subscription?.id, visible, valid, route.error, attempt]);
  useLayoutEffect(() => {
    if (visible && !previousVisible.current)
      window.scrollTo({ top: scroll.current, behavior: "instant" });
    previousVisible.current = visible;
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const save = () => {
      scroll.current = window.scrollY;
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [visible]);
  useLayoutEffect(() => {
    scroll.current = 0;
    if (visible) window.scrollTo({ top: 0, behavior: "instant" });
  }, [key]);
  function search(event: FormEvent) {
    event.preventDefault();
    if (draft.trim())
      navigate(
        browseHash({
          searching: true,
          crossSearching: true,
          query: draft.trim(),
          category: "",
          page: 1,
        }),
      );
  }
  const groups = current?.groups || [];
  const ready = groups.filter(
    (group) => group.status === "ready" || group.status === "error",
  ).length;
  const failed = groups.filter((group) => group.status === "error");
  const empty = groups.filter(
    (group) => group.status === "ready" && !group.data?.films.length,
  );
  const ordered =
    display?.order
      .map((id) => display.groups.find((group) => group.site.key === id)!)
      .filter(Boolean) || [];
  return (
    <main
      id={visible ? "content" : undefined}
      hidden={!visible}
      inert={!visible}
      className="catalog-page search-page cross-search-page"
    >
      <header className="catalog-heading">
        <div>
          <h1>搜索</h1>
        </div>
        <form className="catalog-search" onSubmit={search}>
          <Search />
          <Input
            aria-label="跨站搜索片名"
            placeholder="搜索影片、剧集、综艺"
            maxLength={100}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" disabled={!draft.trim() || !eligible}>
            搜索
          </Button>
        </form>
      </header>
      <SearchScope cross query={route.query} site={site?.name} />
      <p className="cross-search-explainer">
        {subscription?.name || "当前片库"} · {eligible} 个可搜索来源
        <span> · 同名影片按来源分别展示</span>
      </p>
      {!subscription ? (
        <section className="media-empty">
          <h2>先选一个片库</h2>
          <p>片库打开后，可同时查找其中支持搜索的来源。</p>
          <Button onClick={onLibrary}>选择片库</Button>
        </section>
      ) : null}
      {subscription && !eligible ? (
        <section className="media-empty">
          <h2>这个片库暂无可搜索来源</h2>
          <p>可以选择其他片库；不支持网页播放或已关闭搜索的来源不会参与。</p>
          <Button onClick={onLibrary}>选择其他片库</Button>
        </section>
      ) : null}
      {route.error ? (
        <p className="cross-search-error" role="alert">
          {route.error} 请修改搜索词重新搜索。
        </p>
      ) : null}
      {!route.query.trim() && subscription && eligible > 0 && !route.error ? (
        <p className="catalog-search-hint">
          {draft.trim()
            ? "按回车或点击搜索，查找整个片库。"
            : "输入片名，查找整个片库。"}
        </p>
      ) : null}
      {route.query.trim() && !route.error && eligible ? (
        <>
          <div className="cross-search-progress" role="status">
            <span>
              {pending
                ? `正在查找“${route.query}” · ${ready} / ${eligible} 个来源已完成`
                : `“${route.query}” · 已完成 ${ready} 个来源`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                cache.current = current
                  ? {
                      ...current,
                      groups: current.groups.map((group) => ({
                        ...group,
                        status: "queued",
                        requestedPage: 1,
                        error: "",
                      })),
                    }
                  : null;
                setAttempt((value) => value + 1);
              }}
            >
              重新搜索
            </Button>
          </div>
          <div className="cross-search-layout">
            <div className="cross-search-results">
              {stale ? (
                <p role="status" className="catalog-note">
                  正在读取新结果，暂时保留“{display.query}”的内容。
                </p>
              ) : null}
              <div inert={stale} className="cross-search-groups">
                {ordered.map((group) => {
                  const limit =
                    counts[`${display!.key}|${group.site.key}`] || 12;
                  const films = group.data!.films;
                  const paging = group.data!.pagination;
                  const loading =
                    group.status === "queued" || group.status === "loading";
                  return (
                    <section
                      className={`cross-search-group ${films.length === 1 && (!paging || paging.pages <= 1) ? "cross-search-single" : ""}`}
                      key={`${display!.key}|${group.site.key}`}
                      aria-label={`${group.site.name}搜索结果`}
                    >
                      <header>
                        <div>
                          <h2>来自 {group.site.name}</h2>
                          <p>
                            {paging?.total !== undefined
                              ? `${paging.total} 部匹配影片`
                              : `已找到 ${films.length} 部`}
                          </p>
                        </div>
                        
                      </header>
                      <div className="film-grid">
                        {films.slice(0, limit).map((film) => (
                          <button
                            className="poster-card"
                            key={film.id}
                            onClick={(event) =>
                              onFilm(group.site, film, event.currentTarget)
                            }
                            aria-label={`查看${group.site.name}的${film.name}`}
                          >
                            <div className="poster-card-art">
                              <FilmPoster url={film.poster} name={film.name} />
                              {film.remarks ? (
                                <span className="poster-tag">
                                  {film.remarks}
                                </span>
                              ) : null}
                            </div>
                            <h3>{film.name}</h3>
                            <p>
                              {[film.category, film.year]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </button>
                        ))}
                      </div>
                      {group.error ? (
                        <p className="catalog-note" role="status">
                          更多结果暂未读取：{group.error}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              engine.current?.retry(group.site.key)
                            }
                          >
                            重试此来源
                          </Button>
                        </p>
                      ) : null}
                      <div className="cross-search-more">
                        {films.length > limit ? (
                          <Button
                            variant="ghost"
                            onClick={() =>
                              setCounts((old) => ({
                                ...old,
                                [`${display!.key}|${group.site.key}`]:
                                  limit + 12,
                              }))
                            }
                          >
                            再显示 {Math.min(12, films.length - limit)} 部
                          </Button>
                        ) : paging && paging.page < paging.pages ? (
                          <Button
                            variant="ghost"
                            disabled={loading}
                            onClick={() => engine.current?.next(group.site.key)}
                          >
                            {loading ? "正在读取…" : "更多返回结果"}
                          </Button>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
              {!ordered.length && pending ? (
                <div className="cross-search-wait" role="status">
                  <Search />
                  <h2>正在寻找你的下一部</h2>
                  <p>有结果就会呈现，你可以随时修改片名或离开页面。</p>
                </div>
              ) : null}
              {!ordered.length && !pending && current ? (
                <section className="media-empty">
                  <h2>
                    {failed.length
                      ? "暂时没有找到可用结果"
                      : "没有找到这部影片"}
                  </h2>
                  <p>
                    {failed.length
                      ? failed.length === eligible ? "所有来源均读取失败，请展开来源状态查看原因并重试。" : "部分来源读取失败，可以单独重试或换个片名。"
                      : "试试更短的片名，或选择其他片库。"}
                  </p>
                </section>
              ) : null}
            </div>
            <details
              className="cross-search-status"
              open={statusOpen}
              onToggle={(event) => setStatusOpen(event.currentTarget.open)}
            >
              <summary>
                查看来源状态
                {failed.length ? ` · ${failed.length} 个失败` : ""}
              </summary>
              <ul>
                {groups.map((group) => (
                  <li key={group.site.key}>
                    <div>
                      <strong>{group.site.name}</strong>
                      <span>
                        {group.status === "queued"
                          ? "等待搜索"
                          : group.status === "loading"
                            ? "正在搜索"
                            : group.status === "error"
                              ? group.error
                              : group.data?.films.length
                                ? `已找到 ${group.data.films.length} 部`
                                : "未找到相关影片"}
                      </span>
                    </div>
                    {group.status === "error" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => engine.current?.retry(group.site.key)}
                      >
                        重试
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {empty.length ? (
                <p>{empty.length} 个来源未找到相关影片。</p>
              ) : null}
            </details>
          </div>
        </>
      ) : null}
    </main>
  );
}
