import type { FilmCategory } from "./api";

/** 只按来源给出的父子关系选取子类，不从名称或编号猜测分类归属。 */
export function categoryEntry(
  categories: FilmCategory[],
  category: FilmCategory,
) {
  return (
    categories.find(
      (item) => item.parentId === category.id && item.id !== category.id,
    ) ?? category
  );
}

/** 从各分类分组轮流取首页栏，避免默认首页被第一个大类占满。 */
export function planHomeShelves(categories: FilmCategory[], limit = 8) {
  const roots = categories.filter(
    (item) =>
      !item.parentId ||
      item.parentId === "0" ||
      !categories.some((parent) => parent.id === item.parentId),
  );
  const groups = roots.map((root) => {
    const children = categories.filter(
      (item) => item.parentId === root.id && item.id !== root.id,
    );
    return children.length ? children : [root];
  });
  const result: FilmCategory[] = [];
  for (let offset = 0; result.length < limit; offset++) {
    const next = groups
      .map((group) => group[offset])
      .filter((item): item is FilmCategory => !!item);
    if (!next.length) break;
    for (const item of next) if (result.length < limit) result.push(item);
  }
  return result;
}
