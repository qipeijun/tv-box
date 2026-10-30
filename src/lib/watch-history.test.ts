import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeHistory,
  matchWatchEpisode,
  saveWatchRecord,
  watchKey,
  watchPercent,
  watchTime,
  type WatchRecord,
} from "./watch-history.ts";
const record: WatchRecord = {
  id: watchKey({ builtinId: "curated" }, "site", "film"),
  selection: { builtinId: "curated" },
  libraryName: "精选",
  revision: "revision",
  siteKey: "site",
  siteName: "来源",
  film: {
    id: "film",
    name: "影片",
    poster: null,
    year: "2026",
    category: "剧集",
    remarks: "",
  },
  lineName: "线路",
  episodeName: "第二集",
  position: 123,
  duration: 1000,
  completed: false,
  updatedAt: 1,
};
test("观看记录按订阅、站点、影片隔离，持久化恢复保留真实集数与进度", () => {
  assert.deepEqual(
    decodeHistory(JSON.stringify({ version: 1, records: [record] })),
    [record],
  );
  assert.notEqual(
    record.id,
    watchKey({ builtinId: "extended" }, "site", "film"),
  );
  assert.notEqual(record.id, watchKey(record.selection, "other", "film"));
  assert.equal(watchPercent(record), 12);
  assert.equal(watchTime(3723), "1:02:03");
});
test("无效观看记录明确拒绝，不能把损坏的记录当成空历史覆盖", () => {
  for (const raw of [
    "{",
    JSON.stringify({ version: 2, records: [] }),
    JSON.stringify({ version: 1, records: [{ ...record, id: "wrong" }] }),
    JSON.stringify({ version: 1, records: [{ ...record, position: 2000 }] }),
  ])
    assert.throws(() => decodeHistory(raw));
  assert.deepEqual(decodeHistory(null), []);
});
test("进度更新按观看时间去重排序，最多保留一百部且不修改旧列表", () => {
  const records = Array.from({ length: 100 }, (_, i) => ({
    ...record,
    id: watchKey(record.selection, "site", String(i)),
    film: { ...record.film, id: String(i) },
    updatedAt: i,
  }));
  const saved = saveWatchRecord(records, { ...record, updatedAt: 200 });
  assert.equal(saved.length, 100);
  assert.equal(saved[0].id, record.id);
  assert.equal(records.length, 100);
  assert.equal(
    saveWatchRecord(saved, { ...record, position: 400, updatedAt: 201 })[0]
      .position,
    400,
  );
});
test("续播必须唯一匹配同名线路与集数，不沿用变化后的集序编号", () => {
  const episode = {
    id: "new-index",
    name: "第二集",
    url: "https://example.com/2.m3u8",
    mime: "application/x-mpegURL",
    reason: "",
  };
  const film = {
    ...record.film,
    description: "",
    lines: [{ name: "线路", episodes: [episode] }],
  };
  assert.equal(matchWatchEpisode(film, record)?.id, "new-index");
  assert.equal(
    matchWatchEpisode(
      { ...film, lines: [...film.lines, ...film.lines] },
      record,
    ),
    null,
  );
  assert.equal(
    matchWatchEpisode(
      { ...film, lines: [{ name: "线路", episodes: [episode, episode] }] },
      record,
    ),
    null,
  );
  assert.equal(
    matchWatchEpisode(film, { ...record, episodeName: "第一集" }),
    null,
  );
});
