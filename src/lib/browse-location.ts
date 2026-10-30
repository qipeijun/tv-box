export type BrowseLocation = {
  searching: boolean;
  /** true：主动跨站搜索；false 或缺省：当前站点搜索。 */
  crossSearching?: boolean;
  query: string;
  category: string;
  page: number;
};

/** 浏览状态属于 URL；分页或分类变化会产生可返回的历史条目。 */
export function readBrowseLocation(params: URLSearchParams) {
  const rawPage = params.get("page") || "1";
  const query = params.get("q") || "";
  const category = params.get("category") || "";
  let error = "";
  if (!/^[1-9]\d*$/.test(rawPage) || Number(rawPage) > 100000)
    error = "页码须为 1–100000 的整数。";
  else if (query.length > 100) error = "搜索词不能超过 100 字。";
  else if (category && !/^[a-zA-Z0-9_-]{1,100}$/.test(category))
    error = "分类入口无效，请重新选择分类。";
  return {
    searching: params.has("search"),
    crossSearching: params.has("search") && params.get("scope") === "all",
    query,
    category,
    page: error ? 1 : Number(rawPage),
    error,
  };
}

export function browseHash(value: BrowseLocation) {
  const params = new URLSearchParams();
  params.set(value.searching ? "search" : "browse", "");
  if (value.searching && value.crossSearching) params.set("scope", "all");
  if (value.searching && value.query.trim())
    params.set("q", value.query.trim());
  if (!value.searching && value.category)
    params.set("category", value.category);
  if (value.page > 1) params.set("page", String(value.page));
  return `#${params.toString()}`;
}

/** 详情和播放继续携带浏览来源，选集与返回不会丢失查询、分类和页码。 */
export function mediaHash(
  filmId: string,
  watching = false,
  episodeId?: string,
  origin = location.hash,
) {
  const previous = new URLSearchParams(origin.slice(1));
  const params =
    previous.has("search") || previous.has("browse")
      ? new URLSearchParams(browseHash(readBrowseLocation(previous)).slice(1))
      : new URLSearchParams(
          previous.has("history") ? { history: "", ...(previous.get("view") === "favorites" ? {view: "favorites"} : {}) } : undefined,
        );
  if (previous.get("scope") === "all" && previous.has("site"))
    params.set("site", previous.get("site")!);
  params.set(watching ? "watch" : "film", filmId);
  if (episodeId) params.set("episode", episodeId);
  return `#${params.toString()}`;
}

/** 跨站结果必须携带真实来源，进入详情后明确选集，不沿用旧来源集号。 */
export function crossFilmHash(query: string, site: string, film: string) {
  const params = new URLSearchParams(
    browseHash({
      searching: true,
      crossSearching: true,
      query,
      category: "",
      page: 1,
    }).slice(1),
  );
  params.set("site", site);
  params.set("film", film);
  params.set("select", "1");
  return `#${params}`;
}
