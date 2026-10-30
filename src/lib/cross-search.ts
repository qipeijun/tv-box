import type { FilmPage, Site } from "./api";

/** queued：等待请求名额；loading：读取当前来源；ready：本页完成；error：本次读取失败，旧结果保留。 */
export type SearchStatus = "queued" | "loading" | "ready" | "error";
export type SearchGroup = {
  site: Site;
  status: SearchStatus;
  data: FilmPage | null;
  error: string;
  requestedPage: number;
};
export type SearchSnapshot = { groups: SearchGroup[]; order: string[] };
type Loader = (
  site: Site,
  page: number,
  signal: AbortSignal,
) => Promise<FilmPage>;

/** 同时最多三个来源；显式重试/翻页优先于未开始的来源。取消后不发布任何迟到响应。 */
export function createCrossSearch(
  sites: Site[],
  load: Loader,
  publish: (snapshot: SearchSnapshot) => void,
  seed?: SearchSnapshot,
) {
  const lifetime = new AbortController();
  const groups = new Map<string, SearchGroup>();
  const order = (seed?.order || []).filter((key) =>
    sites.some((site) => site.key === key),
  );
  const jobs: { key: string; page: number }[] = [];
  let active = 0;
  for (const site of sites.filter(
    (site) => site.supported && site.searchable,
  )) {
    const previous = seed?.groups.find((group) => group.site.key === site.key);
    const group: SearchGroup = previous
      ? {
          ...previous,
          site,
          status: previous.status === "loading" ? "queued" : previous.status,
        }
      : { site, status: "queued", data: null, error: "", requestedPage: 1 };
    groups.set(site.key, group);
    if (group.status === "queued")
      jobs.push({ key: site.key, page: group.requestedPage });
  }
  const emit = () => {
    if (!lifetime.signal.aborted)
      publish({ groups: [...groups.values()], order: [...order] });
  };
  async function run(job: { key: string; page: number }) {
    const group = groups.get(job.key)!;
    const timeout = AbortSignal.timeout(18000);
    groups.set(job.key, {
      ...group,
      status: "loading",
      error: "",
      requestedPage: job.page,
    });
    emit();
    try {
      const page = await load(
        group.site,
        job.page,
        AbortSignal.any([lifetime.signal, timeout]),
      );
      if (lifetime.signal.aborted) return;
      if (timeout.aborted) throw Error("来源响应超时，请重试。");
      if (page.pagination && page.pagination.page !== job.page)
        throw Error("来源没有返回请求的页码。");
      const films =
        job.page > 1
          ? [...(group.data?.films || []), ...page.films]
          : page.films;
      const data = {
        ...page,
        films: [...new Map(films.map((film) => [film.id, film])).values()],
      };
      groups.set(job.key, {
        ...group,
        status: "ready",
        data,
        error: "",
        requestedPage: job.page,
      });
      if (data.films.length && !order.includes(job.key)) order.push(job.key);
    } catch (error) {
      if (lifetime.signal.aborted) return;
      groups.set(job.key, {
        ...group,
        status: "error",
        requestedPage: job.page,
        error: timeout.aborted
          ? "这个来源超过 18 秒未完成，可单独重试。"
          : (error as Error).message,
      });
    } finally {
      active--;
      emit();
      pump();
    }
  }
  function pump() {
    while (!lifetime.signal.aborted && active < 3 && jobs.length) {
      active++;
      void run(jobs.shift()!);
    }
  }
  function enqueue(key: string, page: number) {
    const group = groups.get(key);
    if (
      !group ||
      group.status === "loading" ||
      group.status === "queued" ||
      lifetime.signal.aborted
    )
      return;
    groups.set(key, {
      ...group,
      status: "queued",
      error: "",
      requestedPage: page,
    });
    jobs.unshift({ key, page });
    emit();
    pump();
  }
  emit();
  pump();
  return {
    retry(key: string) {
      const group = groups.get(key);
      if (group?.status === "error") enqueue(key, group.requestedPage);
    },
    next(key: string) {
      const group = groups.get(key);
      const pagination = group?.data?.pagination;
      if (pagination && pagination.page < pagination.pages)
        enqueue(key, pagination.page + 1);
    },
    stop() {
      lifetime.abort();
      jobs.length = 0;
    },
  };
}
