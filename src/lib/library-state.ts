/** builtinId：内置片库；url：用户保存的自定义片库地址。 */
export type LibrarySelection = { builtinId: string } | { url: string };
export type CustomLibrary = { id: string; name: string; url: string };
export type LibraryPreferences = {
  /** 版本 2：具名订阅与按片库保存的站点选择。 */
  version: 2;
  selection: LibrarySelection;
  customs: CustomLibrary[];
  siteKeys: Record<string, string>;
};
export const PREFERENCES_KEY = "tvbox.library.v1";
export const DEFAULT_LIBRARY: LibrarySelection = { builtinId: "curated" };
export function libraryKey(selection: LibrarySelection) {
  return "builtinId" in selection
    ? `builtin:${selection.builtinId}`
    : `url:${selection.url}`;
}
export function emptyPreferences(): LibraryPreferences {
  return { version: 2, selection: DEFAULT_LIBRARY, customs: [], siteKeys: {} };
}
export function subscriptionUrl(value: string) {
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href.length > 2048
  )
    throw Error("请输入不含账号密码的完整 HTTP 或 HTTPS 订阅地址。");
  return url.href;
}
function validSelection(value: unknown): value is LibrarySelection {
  if (!value || typeof value !== "object") return false;
  if ("builtinId" in value)
    return typeof value.builtinId === "string" && !!value.builtinId;
  if ("url" in value && typeof value.url === "string") {
    try {
      subscriptionUrl(value.url);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** 原有 URL 列表迁移为具名订阅，读取错误单独报告，不假装本地记录不存在。 */
export function decodeLibraryPreferences(
  raw: string | null,
): LibraryPreferences {
  if (!raw) return emptyPreferences();
  const value = JSON.parse(raw);
  if (
    !validSelection(value.selection) ||
    !Array.isArray(value.customs) ||
    value.customs.length > 20
  )
    throw Error("本地订阅配置格式不正确。");
  let customs: CustomLibrary[];
  let siteKeys: Record<string, string> = {};
  const selection =
    "url" in value.selection
      ? { url: subscriptionUrl(value.selection.url) }
      : value.selection;
  if (value.version === 2) {
    customs = value.customs.map((item: CustomLibrary) => {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        typeof item.name !== "string" ||
        !item.name.trim() ||
        item.name.length > 60 ||
        typeof item.url !== "string"
      )
        throw Error("本地订阅记录不完整。");
      return { id: item.id, name: item.name, url: subscriptionUrl(item.url) };
    });
    if (
      !value.siteKeys ||
      typeof value.siteKeys !== "object" ||
      Array.isArray(value.siteKeys)
    )
      throw Error("本地站点选择格式不正确。");
    siteKeys = Object.fromEntries(
      Object.entries(value.siteKeys).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } else if (value.version === undefined) {
    customs = value.customs.map((url: string, index: number) => ({
      id: `legacy-${index}`,
      name: `自定义片库 ${index + 1}`,
      url: subscriptionUrl(url),
    }));
    if (typeof value.siteKey === "string")
      siteKeys[libraryKey(selection)] = value.siteKey;
  } else throw Error("本地订阅配置版本不受支持。");
  if (
    new Set(customs.map((item) => item.id)).size !== customs.length ||
    new Set(customs.map((item) => item.url)).size !== customs.length
  )
    throw Error("本地订阅存在重复记录。");
  return {
    version: 2,
    customs,
    siteKeys,
    selection:
      "url" in selection && !customs.some((item) => item.url === selection.url)
        ? DEFAULT_LIBRARY
        : selection,
  };
}

/** 保存只修改对应订阅；地址改变时清理旧站点身份，避免复用影片编号。 */
export function saveCustomLibrary(
  preferences: LibraryPreferences,
  draft: CustomLibrary,
): LibraryPreferences {
  const name = draft.name.trim();
  if (!name || name.length > 60) throw Error("请填写 1–60 字的片库名称。");
  const next = { ...draft, name, url: subscriptionUrl(draft.url) };
  const previous = preferences.customs.find((item) => item.id === draft.id);
  if (
    preferences.customs.some(
      (item) => item.id !== draft.id && item.url === next.url,
    )
  )
    throw Error("这个订阅地址已经添加过了。");
  if (!previous && preferences.customs.length >= 20)
    throw Error("最多保存 20 个自定义订阅，请先删除不再使用的片库。");
  const customs = previous
    ? preferences.customs.map((item) => (item.id === next.id ? next : item))
    : [...preferences.customs, next];
  const siteKeys = { ...preferences.siteKeys };
  let selection = preferences.selection;
  if (previous && previous.url !== next.url) {
    delete siteKeys[libraryKey({ url: previous.url })];
    if (libraryKey(selection) === libraryKey({ url: previous.url }))
      selection = { url: next.url };
  }
  return { ...preferences, customs, siteKeys, selection };
}

export function removeCustomLibrary(
  preferences: LibraryPreferences,
  id: string,
): LibraryPreferences {
  const item = preferences.customs.find((entry) => entry.id === id);
  if (!item) return preferences;
  const key = libraryKey({ url: item.url });
  const siteKeys = { ...preferences.siteKeys };
  delete siteKeys[key];
  return {
    ...preferences,
    customs: preferences.customs.filter((entry) => entry.id !== id),
    siteKeys,
    selection:
      libraryKey(preferences.selection) === key
        ? DEFAULT_LIBRARY
        : preferences.selection,
  };
}
