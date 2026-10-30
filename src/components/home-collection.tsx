import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { FilmShelf } from "./film-shelf";
import {
  api,
  sitePath,
  type Film,
  type FilmCategory,
  type FilmPage,
  type Site,
  type Subscription,
} from "@/lib/api";
import { categoryEntry, planHomeShelves } from "@/lib/home-shelves";

type Shelf = { category: FilmCategory; data: FilmPage | null; error: string };
type Collection = {
  key: string;
  categories: FilmCategory[] | null;
  error: string;
  shelves: Shelf[];
  generation: string;
};

export function HomeCollection({
  subscription,
  site,
  visible,
  total,
  onFilm,
  onBrowse,
  children,
}: {
  subscription: Subscription | null;
  site: Site | undefined;
  visible: boolean;
  total?: number;
  onFilm: (film: Film) => void;
  onBrowse: (category: string, trigger: HTMLButtonElement) => void;
  children: ReactNode;
}) {
  const base = subscription && site ? sitePath(subscription, site) : "";
  const key = `${subscription?.revision}|${site?.key}`;
  const generation = subscription?.fetchedAt || "";
  const [value, setValue] = useState<Collection | null>(null);
  const cache = useRef<Collection | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current = value?.key === key ? value : null;
  useEffect(() => {
    if (!base || !visible) return;
    const controller = new AbortController();
    const state: Collection =
      cache.current?.key === key
        ? cache.current
        : { key, categories: null, error: "", shelves: [], generation: "" };
    cache.current = state;
    const publish = () => {
      if (!controller.signal.aborted && cache.current === state)
        setValue({
          ...state,
          shelves: state.shelves.map((shelf) => ({ ...shelf })),
        });
    };
    const refreshing = state.generation !== generation;
    async function read() {
      if ((!state.categories || refreshing) && !state.error) {
        try {
          const result = await api<{ categories: FilmCategory[] }>(
            `${base.replace(/\/videos$/, "")}/categories`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          state.categories = result.categories;
          state.shelves = planHomeShelves(result.categories).map(
            (category) => ({
              category,
              data:
                state.shelves.find((shelf) => shelf.category.id === category.id)
                  ?.data || null,
              error: "",
            }),
          );
        } catch (reason) {
          if (!controller.signal.aborted)
            state.error = (reason as Error).message;
        }
        publish();
      }
      const pending = state.shelves.filter(
        (shelf) => (refreshing || !shelf.data) && !shelf.error,
      );
      // 首页最多并行读取两栏，进入详情或其他页面后取消未完成的加载。
      for (
        let offset = 0;
        offset < pending.length && !controller.signal.aborted;
        offset += 2
      ) {
        await Promise.all(
          pending.slice(offset, offset + 2).map(async (shelf) => {
            try {
              const result = await api<FilmPage>(
                `${base}?category=${encodeURIComponent(shelf.category.id)}&page=1`,
                { signal: controller.signal },
              );
              if (controller.signal.aborted) return;
              shelf.data = result;
            } catch (reason) {
              if (!controller.signal.aborted)
                shelf.error = (reason as Error).message;
            }
            publish();
          }),
        );
      }
      if (!controller.signal.aborted) state.generation = generation;
    }
    publish();
    void read();
    return () => controller.abort();
  }, [base, key, generation, visible, attempt]);
  function retry(id?: string) {
    const state = cache.current;
    if (!state || state.key !== key) return;
    if (id) {
      const shelf = state.shelves.find((item) => item.category.id === id);
      if (shelf) shelf.error = "";
    } else state.error = "";
    setAttempt((count) => count + 1);
  }
  function browse(category: string, trigger: HTMLButtonElement) {
    onBrowse(category, trigger);
  }
  const categories = current?.categories ?? [];
  const roots = categories.filter(
    (item) =>
      !item.parentId ||
      item.parentId === "0" ||
      !categories.some((parent) => parent.id === item.parentId),
  );
  return (
    <>
      {children}
      {site ? (
        <nav className="home-category-nav" aria-label="首页分类">
          <div className="home-source-summary">
            <span>{site.name}</span>
            {total !== undefined ? (
              <span>{total.toLocaleString("zh-CN")} 部影片</span>
            ) : null}
          </div>
          <div className="home-category-links">
            <button onClick={(event) => browse("", event.currentTarget)}>
              全部影片
              <ChevronRight />
            </button>
            {roots.map((category) => (
              <button
                key={category.id}
                onClick={(event) =>
                  browse(
                    categoryEntry(categories, category).id,
                    event.currentTarget,
                  )
                }
              >
                {category.name}
              </button>
            ))}
          </div>
          {current?.error ? (
            <p className="home-category-error">
              分类暂未读取：{current.error}
              <Button size="sm" variant="ghost" onClick={() => retry()}>
                重试分类
              </Button>
            </p>
          ) : !current?.categories ? (
            <span className="sr-only" role="status">
              正在读取分类
            </span>
          ) : null}
        </nav>
      ) : null}
      {current?.shelves.length ? (
        <div className="home-category-shelves">
          {current.shelves.map((shelf) =>
            shelf.data?.films.length ? (
              <FilmShelf
                key={shelf.category.id}
                title={shelf.category.name}
                subtitle={
                  shelf.error
                    ? `更新未完成，保留上次内容 · ${shelf.error}`
                    : shelf.data.pagination?.total !== undefined
                      ? `${shelf.data.pagination.total.toLocaleString("zh-CN")} 部 · ${site?.name}`
                      : site?.name
                }
                films={shelf.data.films.slice(0, 16)}
                onSelect={onFilm}
                onViewAll={(trigger) => browse(shelf.category.id, trigger)}
              />
            ) : shelf.error ? (
              <section key={shelf.category.id} className="home-shelf-error">
                <h2>{shelf.category.name}</h2>
                <p>{shelf.error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => retry(shelf.category.id)}
                >
                  重试这一栏
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) =>
                    browse(shelf.category.id, event.currentTarget)
                  }
                >
                  浏览分类
                  <ChevronRight />
                </Button>
              </section>
            ) : !shelf.data ? (
              <section
                key={shelf.category.id}
                className="home-shelf-loading"
                aria-label={`正在读取${shelf.category.name}`}
                aria-busy="true"
              >
                <div className="shelf-heading">
                  <h2>{shelf.category.name}</h2>
                  <span role="status">正在读取…</span>
                </div>
                <div className="poster-rail">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div className="home-shelf-placeholder" key={index} aria-hidden="true">
                      <Skeleton className="catalog-poster-skeleton" />
                      <Skeleton className="home-shelf-title-placeholder" />
                      <Skeleton className="home-shelf-meta-placeholder" />
                    </div>
                  ))}
                </div>
              </section>
            ) : null,
          )}
        </div>
      ) : null}
    </>
  );
}
