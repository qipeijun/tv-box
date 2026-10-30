import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryEntry, planHomeShelves } from "./home-shelves.ts";

test("首页按真实分类分组轮流取栏，不被第一组占满，也不把父节点当聚合接口", () => {
  const categories = [
    { id: "1", name: "电影", parentId: "0" },
    { id: "2", name: "连续剧", parentId: "0" },
    { id: "6", name: "动作", parentId: "1" },
    { id: "7", name: "喜剧", parentId: "1" },
    { id: "13", name: "国产剧", parentId: "2" },
    { id: "14", name: "香港剧", parentId: "2" },
  ];
  assert.deepEqual(
    planHomeShelves(categories).map((item) => item.id),
    ["6", "13", "7", "14"],
  );
  assert.equal(categoryEntry(categories, categories[0]).id, "6");
  assert.equal(categoryEntry(categories, categories[2]).id, "6");
});

test("平铺分类保持来源顺序并限制首页请求数，不从片名或分类名推造层级", () => {
  const flat = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    name: `来源分类${index}`,
  }));
  assert.deepEqual(
    planHomeShelves(flat).map((item) => item.id),
    ["0", "1", "2", "3", "4", "5", "6", "7"],
  );
  assert.deepEqual(planHomeShelves([]), []);
});
