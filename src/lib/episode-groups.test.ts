import { test } from "node:test";
import assert from "node:assert/strict";
import { episodeGroups } from "./episode-groups.ts";
import type { Episode } from "./api";

const episodes: Episode[] = Array.from({ length: 538 }, (_, index) => ({
  id: String(index), name: index < 2 ? "同名期" : `${20221102 + index}期`,
  url: `https://example.com/${index}`, mime: "video/mp4", reason: "",
}));

test("538 集倒序保留固定范围，尾组不足30集且每集恰好出现一次", () => {
  const groups = episodeGroups(episodes, true);
  assert.equal(groups.length, 18);
  assert.equal(groups[0].label, "538–511");
  assert.equal(groups[0].episodes.length, 28);
  assert.equal(groups[0].episodes[0], episodes[537]);
  assert.equal(groups[17].label, "30–1");
  assert.deepEqual(groups.flatMap(group => group.episodes), [...episodes].reverse());
  assert.equal(episodes[0].id, "0");
});
test("排序后当前集保持身份，边界集与同名集不丢失，正序可还原", () => {
  const groups = episodeGroups(episodes, true);
  assert.equal(groups.findIndex(group => group.episodes.includes(episodes[30])), 16);
  assert.equal(groups.findIndex(group => group.episodes.includes(episodes[29])), 17);
  assert.deepEqual(episodeGroups(episodes, false).flatMap(group => group.episodes), episodes);
  assert.deepEqual(groups[17].episodes.slice(-2).map(item => item.id), ["1", "0"]);
  assert.deepEqual(episodeGroups([], true), []);
  assert.equal(episodeGroups(episodes.slice(0, 1), true)[0].label, "1–1");
});
