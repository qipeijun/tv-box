import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Search,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { SearchScope } from "./search-scope";
import { FilmPoster } from "./film-poster";
import {
  api,
  sitePath,
  type Film,
  type FilmCategory,
  type FilmPage,
  type Site,
  type Subscription,
} from "@/lib/api";
import { browseHash, readBrowseLocation } from "@/lib/browse-location";
import { navigate, useMediaRoute } from "@/lib/navigation";
import { categoryEntry } from "@/lib/home-shelves";

export default function BrowseView({
  subscription,
  site,
  scope,
  valid,
  busy,
  libraryError,
  onLibrary,
  onFilm,
}: {
  subscription: Subscription | null;
  site: Site | undefined;
  scope: string;
  valid: boolean;
  busy: boolean;
  libraryError: string;
  onLibrary: () => void;
  onFilm: (film: Film, trigger: HTMLButtonElement) => void;
}) {
  const route = useMediaRoute();
  const visible = !route.filmId && !route.live && !route.managing;
  const base = subscription && site ? sitePath(subscription, site) : "";
  const key = `${scope}|${route.searching}|${route.query}|${route.category}|${route.page}`;
  const [draft, setDraft] = useState(route.query);
  const [pageDraft, setPageDraft] = useState(String(route.page));
  const [result, setResult] = useState<{
    key: string;
    scope: string;
    label: string;
    page: number;
    data: FilmPage;
  } | null>(null);
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [pendingKey, setPendingKey] = useState("");
  const [retry, setRetry] = useState(0);
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [categoryResult, setCategoryResult] = useState<{
    scope: string;
    categories: FilmCategory[];
    error: string;
  } | null>(null);
  const positions = useRef(new Map<string, number>());
  const restored = useRef("");
  const heading = useRef<HTMLHeadingElement>(null);
  const categories =
    categoryResult?.scope === scope ? categoryResult.categories : [];
  const categoryError =
    categoryResult?.scope === scope ? categoryResult.error : "";
  const categoryReady = categoryResult?.scope === scope;
  const category = categories.find((item) => item.id === route.category);
  const unavailableCategory =
    !route.searching &&
    !!route.category &&
    categoryReady &&
    !category &&
    !categoryError;
  const roots = categories.filter(
    (item) =>
      !item.parentId ||
      item.parentId === "0" ||
      !categories.some((parent) => parent.id === item.parentId),
  );
  const root =
    category &&
    (roots.find((item) => item.id === category.id) ??
      roots.find((item) => item.id === category.parentId));
  const children = root
    ? categories.filter(
        (item) => item.parentId === root.id && item.id !== root.id,
      )
    : [];
  const data = result?.key === key ? result.data : null;
  const error = failure?.key === key ? failure.message : "";
  const shouldRead =
    !!base &&
    valid &&
    !route.error &&
    !unavailableCategory &&
    (!route.searching || !!route.query.trim()) &&
    (!route.category || route.searching || (categoryReady && !categoryError));
  const display =
    data || (shouldRead && result?.scope === scope ? result.data : null);
  const stale = !!display && !data;
  const loading = shouldRead && ((!data && !error) || pendingKey === key);

  useEffect(() => setDraft(route.query), [route.query]);
  useEffect(() => setPageDraft(String(route.page)), [route.page]);
  useEffect(() => {
    if (!base || !valid || route.searching) return;
    const controller = new AbortController();
    setCategoryResult((previous) =>
      previous?.scope === scope ? previous : null,
    );
    api<{ categories: FilmCategory[] }>(
      `${base.replace(/\/videos$/, "")}/categories`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted)
          setCategoryResult({ scope, categories: value.categories, error: "" });
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setCategoryResult({ scope, categories: [], error: reason.message });
      });
    return () => controller.abort();
  }, [base, scope, valid, route.searching, categoryRetry]);
  useEffect(() => {
    if (!shouldRead) return;
    const controller = new AbortController();
    setFailure(null);
    setPendingKey(key);

    const params = new URLSearchParams({ page: String(route.page) });
    if (route.searching) params.set("search", route.query.trim());
    else if (route.category) params.set("category", route.category);
    api<FilmPage>(`${base}?${params}`, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.pagination && value.pagination.page !== route.page)
          throw Error("来源没有返回请求的页码。请回到第一页，或选择其他来源。");
        setPendingKey("");
        setResult({
          key,
          scope,
          page: route.page,
          label: route.searching
            ? `“${route.query}”的搜索结果`
            : category?.name || "全部影片",
          data: value,
        });
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setPendingKey("");
          setFailure({ key, message: reason.message });
        }
      });
    return () => controller.abort();
  }, [base, key, shouldRead, retry]);
  useEffect(() => {
    if (!visible || !data) return;
    const remember = () => {
      const current = new URLSearchParams(location.hash.slice(1));
      if (
        current.has("film") ||
        current.has("watch") ||
        current.has("library") ||
        current.has("live")
      )
        return;
      const actual = readBrowseLocation(current);
      if (
        `${scope}|${actual.searching}|${actual.query}|${actual.category}|${actual.page}` !==
        key
      )
        return;
      positions.current.set(key, window.scrollY);
      if (positions.current.size > 50)
        positions.current.delete(positions.current.keys().next().value!);
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, [key, visible, !!data]);
  useLayoutEffect(() => {
    if (!visible || !data) {
      restored.current = "";
      return;
    }
    if (!data || restored.current === key) return;
    window.scrollTo({
      top: positions.current.get(key) ?? 0,
      behavior: "instant",
    });
    if (!positions.current.has(key))
      heading.current?.focus({ preventScroll: true });
    restored.current = key;
  }, [visible, key, data]);

  function move(categoryId: string, page = 1) {
    if (data) positions.current.set(key, window.scrollY);
    navigate(
      browseHash({
        searching: route.searching,
        query: route.query,
        category: categoryId,
        page,
      }),
    );
  }
  function search(event: FormEvent) {
    event.preventDefault();
    if (draft.trim())
      navigate(
        browseHash({
          searching: true,
          query: draft.trim(),
          category: "",
          page: 1,
        }),
      );
  }
  const pagination = display?.pagination;
  const outsidePages =
    !!pagination && route.page > Math.max(1, pagination.pages);
  return (
    <main
      id={visible ? "content" : undefined}
      hidden={!visible}
      inert={!visible}
      className={route.searching ? "catalog-page search-page" : "catalog-page"}
    >
      <header className="catalog-heading">
        <div>
          <p>{site?.name || "当前片库"}</p>
          <h1 ref={heading} tabIndex={-1}>
            {route.searching ? "搜索" : "浏览影片"}
          </h1>
        </div>
        <form onSubmit={search} className="catalog-search">
          <Search />
          <Input
            aria-label="搜索当前站点"
            placeholder="搜索影片、剧集、综艺"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={100}
          />
          <Button type="submit" disabled={!draft.trim() || !site}>
            搜索
          </Button>
        </form>
      </header>
      {route.searching ? (
        <SearchScope cross={false} query={route.query} site={site?.name} />
      ) : null}
      {!route.searching && categoryReady && categories.length ? (
        <nav className="catalog-categories" aria-label="影片分类">
          <div className="category-primary">
            <button aria-pressed={!route.category} onClick={() => move("")}>
              全部
            </button>
            {roots.map((item) => (
              <button
                key={item.id}
                aria-pressed={root?.id === item.id}
                onClick={() => move(categoryEntry(categories, item).id)}
              >
                {item.name}
              </button>
            ))}
          </div>
          {children.length ? (
            <div className="category-secondary">
              {children.map((item) => (
                <button
                  key={item.id}
                  aria-pressed={category?.id === item.id}
                  onClick={() => move(item.id)}
                >
                  {item.name}
                </button>
              ))}
            </div>
          ) : null}
        </nav>
      ) : null}
      {!route.searching && base && !categoryReady ? (
        <p className="catalog-note" role="status">
          正在读取分类…
        </p>
      ) : null}
      {!route.searching && categoryError ? (
        <p className="catalog-note" role="status">
          分类暂时没有读取成功：{categoryError}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCategoryRetry((value) => value + 1)}
          >
            重试分类
          </Button>
        </p>
      ) : null}
      {!route.searching &&
      categoryReady &&
      !categories.length &&
      !categoryError ? (
        <p className="catalog-note">
          这个来源未提供分类，可以浏览全部影片或按名称搜索。
        </p>
      ) : null}
      {busy && !subscription ? (
        <p className="catalog-note" role="status">
          正在连接片库…
        </p>
      ) : null}
      {(!subscription || !site) && !busy ? (
        <section className="media-empty">
          <h2>先选一个片库</h2>
          <p>
            {libraryError || "选择支持网页浏览的内容来源，就可以开始找片。"}
          </p>
          <Button onClick={onLibrary}>选择片库</Button>
        </section>
      ) : null}
      {route.error || unavailableCategory ? (
        <section className="media-empty" role="alert">
          <h2>这个浏览入口已不可用</h2>
          <p>{route.error || "来源中已没有这个分类，请重新选择。"}</p>
          <Button
            onClick={() =>
              navigate(
                browseHash({
                  searching: false,
                  query: "",
                  category: "",
                  page: 1,
                }),
              )
            }
          >
            回到全部影片
          </Button>
        </section>
      ) : null}
      {route.searching && !route.query.trim() && subscription && site && !route.error ? (
        <p className="catalog-search-hint">
          {draft.trim()
            ? "按回车或点击搜索，查找当前来源。"
            : `输入片名，搜索「${site.name}」。`}
        </p>
      ) : null}
      {loading && !display ? (
        <section aria-label="正在读取影片" aria-busy="true">
          <p className="catalog-note" role="status">
            正在读取{route.searching ? "搜索结果" : "影片"}…
          </p>
          <div className="film-grid">
            {Array.from({ length: 12 }, (_, index) => (
              <div className="catalog-loading-card" key={index}>
                <Skeleton className="catalog-poster-skeleton" />
                <Skeleton className="catalog-title-skeleton" />
                <Skeleton className="catalog-meta-skeleton" />
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {error && !display ? (
        <section className="media-empty" role="alert">
          <h2>{route.searching ? "搜索暂时没有完成" : "这页暂时没有打开"}</h2>
          <p>{error}</p>
          <div>
            <Button onClick={() => setRetry((value) => value + 1)}>
              重试本页
            </Button>
            {route.page > 1 ? (
              <Button variant="outline" onClick={() => move(route.category, 1)}>
                回到第一页
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
      {display ? (
        <section
          aria-label={route.searching ? "搜索结果" : "影片列表"}
          aria-busy={loading}
        >
          <div className="catalog-status-slot">
            {stale || (loading && data) || error ? (
              <p className="catalog-update-status" role="status">
                {error
                  ? `内容读取未完成：${error}。保留上次结果。`
                  : "正在读取新内容，保留上次结果…"}
                {error ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      重试本页
                    </Button>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <div inert={stale}>
            <div className="catalog-result-heading">
              <h2>{result?.label}</h2>
              <p>
                {pagination?.total !== undefined
                  ? `${pagination.total.toLocaleString("zh-CN")} 部`
                  : `本页 ${display.films.length} 部`}{" "}
                · {site?.name}
              </p>
            </div>
            <div className="film-grid">
              {display.films.map((film) => (
                <button
                  className="poster-card"
                  key={film.id}
                  onClick={(event) => onFilm(film, event.currentTarget)}
                  aria-label={`查看${film.name}`}
                  title={film.name}
                >
                  <div className="poster-card-art">
                    <FilmPoster
                      key={film.poster}
                      url={film.poster}
                      name={film.name}
                    />
                    {film.remarks ? (
                      <span className="poster-tag">{film.remarks}</span>
                    ) : null}
                  </div>
                  <h3>{film.name}</h3>
                  <p>
                    {[film.category, film.year].filter(Boolean).join(" · ")}
                  </p>
                </button>
              ))}
            </div>
            {!display.films.length ? (
              <div className="media-empty">
                <h2>
                  {outsidePages
                    ? "已超出当前页数"
                    : route.searching
                      ? "没有找到这部影片"
                      : "这个分类暂时没有影片"}
                </h2>
                <p>
                  {route.searching
                    ? "换个关键词，或选择其他来源。"
                    : "可以换一个分类，或稍后重新加载。"}
                </p>
                {route.page > 1 ? (
                  <Button onClick={() => move(route.category, 1)}>
                    回到第一页
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
            {pagination && pagination.pages > 0 ? (
              <nav className="catalog-pagination" aria-label="影片分页" aria-busy={loading}>
                <Button
                  variant="outline"
                  disabled={!stale && route.page <= 1}
                  aria-disabled={stale || route.page <= 1}
                  onClick={() => { if (!stale) move(route.category, route.page - 1); }}
                >
                  <ChevronLeft />
                  <span>上一页</span>
                </Button>
                <div className="pagination-position">
                  {stale ? error ? <><span>第 {route.page} 页未能打开</span><Button variant="ghost" onClick={() => setRetry(value => value + 1)}>重试本页</Button></> : <span aria-hidden="true"><LoaderCircle className="animate-spin" />正在打开第 {route.page} 页…</span> : <span>第 {result?.page} / {pagination.pages} 页</span>}
                </div>
                <Button
                  variant="outline"
                  disabled={!stale && route.page >= pagination.pages}
                  aria-disabled={stale || route.page >= pagination.pages}
                  onClick={() => { if (!stale) move(route.category, route.page + 1); }}
                >
                  <span>下一页</span>
                  <ChevronRight />
                </Button>
                {pagination.pages > 3 ? (
                  <form
                    className="catalog-page-jump"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!stale) move(route.category, Number(pageDraft));
                    }}
                  >
                    <Input
                      aria-label="跳转页码"
                      readOnly={stale}
                      type="number"
                      required
                      min={1}
                      max={Math.min(pagination.pages, 100000)}
                      value={pageDraft}
                      onChange={(event) => setPageDraft(event.target.value)}
                    />
                    <Button variant="ghost" type="submit" aria-disabled={stale || undefined}>
                      前往
                    </Button>
                  </form>
                ) : null}
              </nav>
            ) : null}
            {!pagination ? (
              <p className="catalog-note">
                这个来源未提供分页信息，仅展示本次返回的影片。
              </p>
            ) : null}
        </section>
      ) : null}
    </main>
  );
}
