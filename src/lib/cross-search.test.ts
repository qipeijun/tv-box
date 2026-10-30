import { test } from "node:test";
import assert from "node:assert/strict";
import { createCrossSearch, type SearchSnapshot } from "./cross-search.ts";
import type { FilmPage, Site } from "./api";
const sites: Site[] = Array.from({ length: 6 }, (_, i) => ({
  key: String(i),
  name: `来源${i}`,
  supported: true,
  searchable: true,
  reason: "",
}));
const page = (id = "same", number = 1): FilmPage => ({
  films: [
    {
      id,
      name: "同名影片",
      poster: null,
      year: "2026",
      category: "电影",
      remarks: "",
      description: "",
    },
  ],
  pagination: { page: number, pages: 2, total: 2 },
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
test("跨站逐源呈现、并发最多三个，部分失败不妨碍其他来源，同名与同编号不跨来源合并", async () => {
  let current: SearchSnapshot = { groups: [], order: [] };
  let active = 0,
    maximum = 0;
  const waiting: {
    resolve: (value: FilmPage) => void;
    reject: (error: Error) => void;
  }[] = [];
  const run = createCrossSearch(
    sites,
    () =>
      new Promise((resolve, reject) => {
        active++;
        maximum = Math.max(maximum, active);
        waiting.push({
          resolve: (value) => {
            active--;
            resolve(value);
          },
          reject: (error) => {
            active--;
            reject(error);
          },
        });
      }),
    (value) => (current = value),
  );
  assert.equal(waiting.length, 3);
  waiting[0].resolve(page());
  await flush();
  assert.equal(current.groups[0].status, "ready");
  assert.equal(current.groups[1].status, "loading");
  assert.equal(waiting.length, 4);
  waiting[1].reject(Error("来源失败"));
  waiting[2].resolve(page());
  await flush();
  waiting.slice(3).forEach((job) => job.resolve(page()));
  await flush();
  assert.equal(maximum, 3);
  assert.equal(
    current.groups.filter((group) => group.data?.films.length).length,
    5,
  );
  assert.equal(current.groups[1].error, "来源失败");
  run.stop();
});
test("取消后不继续出队，忽略迟到响应，不污染新查询", async () => {
  let publications = 0;
  const pending: ((value: FilmPage) => void)[] = [];
  const run = createCrossSearch(
    sites,
    (_, __, signal) => {
      assert.equal(signal.aborted, false);
      return new Promise((resolve) => pending.push(resolve));
    },
    () => publications++,
  );
  run.stop();
  const before = publications;
  pending.forEach((resolve) => resolve(page()));
  await flush();
  assert.equal(publications, before);
  assert.equal(pending.length, 3);
});
test("单源重试只请求失败来源，分页保留已有结果并按来源内身份去重", async () => {
  let current: SearchSnapshot = { groups: [], order: [] };
  const calls: string[] = [];
  let failed = false;
  const run = createCrossSearch(
    sites.slice(0, 2),
    async (site, n) => {
      calls.push(`${site.key}:${n}`);
      if (site.key === "1" && !failed) {
        failed = true;
        throw Error("暂不可用");
      }
      return n === 1
        ? page()
        : { ...page("new", 2), films: [...page().films, ...page("new").films] };
    },
    (value) => (current = value),
  );
  await flush();
  run.retry("1");
  await flush();
  assert.deepEqual(calls, ["0:1", "1:1", "1:1"]);
  run.next("0");
  await flush();
  assert.equal(current.groups[0].data?.films.length, 2);
  assert.equal(current.groups[0].data?.pagination?.page, 2);
  assert.equal(current.groups[1].data?.films[0].id, "same");
  run.stop();
});
test("详情返回继续未完成来源，已成功和失败结果均保留，不重复请求", async () => {
  let current: SearchSnapshot = { groups: [], order: [] };
  let finish!: () => void;
  const first = createCrossSearch(
    sites.slice(0, 2),
    async (site) => {
      if (site.key === "1")
        await new Promise<void>((resolve) => (finish = resolve));
      return page();
    },
    (value) => (current = value),
  );
  await flush();
  first.stop();
  const calls: string[] = [];
  const resumed = createCrossSearch(
    sites.slice(0, 2),
    async (site) => {
      calls.push(site.key);
      return page();
    },
    (value) => (current = value),
    current,
  );
  await flush();
  assert.deepEqual(calls, ["1"]);
  assert.deepEqual(current.order, ["0", "1"]);
  finish();
  resumed.stop();
});
