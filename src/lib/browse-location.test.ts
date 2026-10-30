import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browseHash,
  crossFilmHash,
  mediaHash,
  readBrowseLocation,
} from "./browse-location.ts";

test("查询、分类与分页可从地址恢复，中文及特殊字符不改变查询含义", () => {
  const search = browseHash({
    searching: true,
    query: " 猫 & 狗 ",
    category: "13",
    page: 3,
  });
  const parsed = readBrowseLocation(new URLSearchParams(search.slice(1)));
  assert.equal(parsed.query, "猫 & 狗");
  assert.equal(parsed.page, 3);
  assert.equal(parsed.category, "");
  const browse = readBrowseLocation(
    new URLSearchParams(
      browseHash({
        searching: false,
        query: "",
        category: "13",
        page: 2,
      }).slice(1),
    ),
  );
  assert.equal(browse.category, "13");
  assert.equal(browse.page, 2);
});

test("进入详情、播放和切集时保留原浏览上下文，不把旧影片或集数带入新选择", () => {
  const details = mediaHash(
    "film-a",
    false,
    undefined,
    "#browse&category=13&page=2",
  );
  const watch = mediaHash("film-a", true, "1:47", details);
  const next = mediaHash("film-a", true, "1:48", watch);
  const params = new URLSearchParams(next.slice(1));
  assert.equal(params.get("category"), "13");
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("watch"), "film-a");
  assert.equal(params.has("film"), false);
  assert.equal(params.get("episode"), "1:48");
  const fromSearch = mediaHash(
    "film-b",
    false,
    undefined,
    "#search&q=%E4%B8%89%E4%BD%93&page=4&watch=old&episode=0%3A0",
  );
  const searched = new URLSearchParams(fromSearch.slice(1));
  assert.equal(searched.get("q"), "三体");
  assert.equal(searched.get("page"), "4");
  assert.equal(searched.has("watch"), false);
  assert.equal(searched.has("episode"), false);
});

test("异常地址参数保留明确错误，不将非法分类当成有效筛选", () => {
  for (const query of [
    "browse&page=0",
    "browse&page=1.5",
    "browse&page=100001",
    "browse&category=%3Cscript%3E",
    `search&q=${"x".repeat(101)}`,
  ])
    assert.ok(readBrowseLocation(new URLSearchParams(query)).error);
  assert.equal(readBrowseLocation(new URLSearchParams("browse")).page, 1);
  assert.equal(mediaHash("123", false, undefined, "#library"), "#film=123");
});

test("跨站搜索保留显式来源到播放和切集，返回搜索不夹带旧影片编号", () => {
  const detail = crossFilmHash("同名 & 影片", "来源/乙", "7");
  const params = new URLSearchParams(detail.slice(1));
  assert.equal(params.get("scope"), "all");
  assert.equal(params.get("site"), "来源/乙");
  assert.equal(params.get("select"), "1");
  const watch = new URLSearchParams(
    mediaHash("7", true, "2:8", detail).slice(1),
  );
  assert.equal(watch.get("site"), "来源/乙");
  assert.equal(watch.get("q"), "同名 & 影片");
  assert.equal(watch.has("select"), false);
  const back = browseHash(readBrowseLocation(watch));
  assert.equal(new URLSearchParams(back.slice(1)).has("film"), false);
  assert.equal(new URLSearchParams(back.slice(1)).get("scope"), "all");
});

test('从收藏进入详情、播放与换集保留资料库入口，不夹带其他影片编号', () => {
  const details = mediaHash('7', false, undefined, '#history&view=favorites');
  const watch = mediaHash('7', true, '0:1', details);
  const next = new URLSearchParams(mediaHash('7', true, '0:2', watch).slice(1));
  assert.equal(next.has('history'), true);
  assert.equal(next.get('view'), 'favorites');
  assert.equal(next.get('watch'), '7');
  assert.equal(next.has('film'), false);
  assert.equal(next.get('episode'), '0:2');
});
