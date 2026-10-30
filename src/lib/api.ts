export type Site = {
  key: string;
  name: string;
  supported: boolean;
  /** true：标准 CMS 搜索可尝试；false：不兼容或配置明确禁用搜索。 */
  searchable: boolean;
  reason: string;
};
export type Subscription = {
  id: string;
  name: string;
  fetchedAt: string;
  /** 订阅配置指纹：配置改变时变化，不随本机会话过期改变。 */
  revision: string;
  sites: Site[];
  livePlaylists: {
    id: string;
    name: string;
    supported: boolean;
    reason: string;
  }[];
};

export type LiveChannel = Episode & { group: string; logo: string | null };
export type LivePlaylist = {
  name: string;
  fetchedAt: string;
  channels: LiveChannel[];
};
export type Builtin = {
  id: string;
  name: string;
  description: string;
  checkedAt: string;
  source: string;
};
export type Episode = {
  id: string;
  name: string;
  url: string | null;
  mime: string | null;
  reason: string;
  /** true：需由后端按当前影片和集数解析；不将临时媒体地址作为集数身份。 */
  needsResolve?: boolean;
  /** quark：夸克分享文件，播放需使用后端保存的本人授权。 */
  platform?: "quark";
};
export type Film = {
  id: string;
  name: string;
  poster: string | null;
  remarks: string;
  year: string;
  category: string;
  description: string;
};
export type FilmDetail = Film & {
  lines: { name: string; episodes: Episode[] }[];
  actors?: string;
  director?: string;
  area?: string;
  language?: string;
};
export type FilmCategory = { id: string; name: string; parentId?: string };
/** cinemeta：电影资料；tvmaze：剧集资料。两者均不提供本应用的播放入口。 */
export type MetadataProvider = "cinemeta" | "tvmaze";
export type FilmMetadata = {
  provider: MetadataProvider;
  id: string;
  name: string;
  year: string;
  poster: string | null;
  background: string | null;
  rating: number | null;
  ratingLabel: string;
  url: string;
  attribution: string;
  warnings: string[];
  runtime: string;
  released: string;
  directors: string[];
  cast: { name: string; role: string; image: string | null }[];
};
export type FilmPage = {
  films: Film[];
  pagination: { page: number; pages: number; total?: number } | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-TVBox-Client": "web-v1",
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      body.error || `请求失败（HTTP ${response.status}）`,
      response.status,
    );
  return body as T;
}

export function sitePath(subscription: Subscription, site: Site) {
  return `/subscriptions/${encodeURIComponent(subscription.id)}/sites/${encodeURIComponent(site.key)}/videos`;
}
