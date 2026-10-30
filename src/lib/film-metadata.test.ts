import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMetadataMatches, exactMetadata } from "./film-metadata.ts";
import type { FilmMetadata } from "./api";

const candidate = (name: string, year: string, id = "tt1") => ({ name, year, id } as FilmMetadata);
test("资料自动匹配排除同名重拍、缺年份、多候选与跨语言猜测", () => {
  const first = candidate("影片", "1993");
  assert.equal(exactMetadata([first, candidate("影片", "2014")], "影片", "1993"), first);
  assert.equal(exactMetadata([first], "影片", ""), null);
  assert.equal(exactMetadata([first, candidate("影片", "1993", "tt2")], "影片", "1993"), null);
  assert.equal(exactMetadata([candidate("Farewell My Concubine", "1993")], "霸王别姬", "1993"), null);
  assert.equal(exactMetadata([first], "其他影片", "1993"), null);
});
test("资料匹配记录按版本与平台ID校验，异常记录不被用于恢复", () => {
  const matches = [{ key: "片库|影片", provider: "cinemeta", id: "tt1" }];
  assert.deepEqual(decodeMetadataMatches(JSON.stringify({ version: 1, matches })), matches);
  assert.deepEqual(decodeMetadataMatches(null), []);
  for (const value of [{ version: 2, matches }, { version: 1, matches: [{ key: "x", provider: "cinemeta", id: "https://example.com" }] }, { version: 1, matches: [{ key: "x", provider: "unknown", id: "1" }] }]) assert.throws(() => decodeMetadataMatches(JSON.stringify(value)));
});
