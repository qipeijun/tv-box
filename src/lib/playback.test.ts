import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchEpisode,
  playableLines,
  playbackTime,
  matchingPosition,
  resolveResume,
  nextEpisode,
} from "./playback.ts";
import type { Episode, FilmDetail } from "./api.ts";

function episode(id: string, name: string): Episode {
  return {
    id,
    name,
    url: `https://example.com/${id}.m3u8`,
    mime: "application/x-mpegURL",
    reason: "",
  };
}

test("续播显示真实时间点，小时、非整数与无效进度均可读", () => {
  assert.equal(playbackTime(1175.9), "19:35");
  assert.equal(playbackTime(3661), "1:01:01");
  assert.equal(playbackTime(-1), "0:00");
  assert.equal(playbackTime(Infinity), "0:00");
});

test("切线匹配仅接受唯一同名集，缺集或重名时不误播第一集", () => {
  const first = episode("1:0", "第01集");
  const second = episode("1:1", "第48集");
  assert.equal(matchEpisode([first, second], "第48集"), second);
  assert.equal(matchEpisode([first, second], "第49集"), null);
  assert.equal(
    matchEpisode([second, episode("1:2", "第48集")], "第48集"),
    null,
  );
});

test("筛除不支持的入口后保留原线路索引与源集序，不按集名自行排序", () => {
  const film = {
    id: "1",
    name: "影片",
    poster: null,
    year: "",
    category: "",
    remarks: "",
    description: "",
    lines: [
      { name: "分享页", episodes: [{ ...episode("0:0", "网页"), mime: null }] },
      {
        name: "HLS",
        episodes: [
          episode("1:0", "特别篇"),
          episode("1:1", "第02集"),
          episode("1:2", "第01集"),
        ],
      },
    ],
  } satisfies FilmDetail;
  const lines = playableLines(film);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].index, 1);
  assert.deepEqual(
    lines[0].episodes.map((item) => item.id),
    ["1:0", "1:1", "1:2"],
  );
});

test("播放位置只属于同来源同影片同集，切源和切集不能借用旧进度", () => {
  const progress = {
    context: "provider-a",
    film: "same",
    episode: "0:0",
    position: 123,
  };
  assert.equal(matchingPosition(progress, "provider-a", "same", "0:0"), 123);
  assert.equal(
    matchingPosition({ ...progress, position: 0 }, "provider-a", "same", "0:0"),
    0,
  );
  assert.equal(
    matchingPosition(progress, "provider-b", "same", "0:0"),
    undefined,
  );
  assert.equal(
    matchingPosition(progress, "provider-a", "other", "0:0"),
    undefined,
  );
  assert.equal(
    matchingPosition(progress, "provider-a", "same", "1:0"),
    undefined,
  );
  assert.equal(
    matchingPosition(
      { ...progress, position: NaN },
      "provider-a",
      "same",
      "0:0",
    ),
    undefined,
  );
});

test("恢复进度等待真实时长与可定位区间，不擅自跳到最近区间", () => {
  assert.deepEqual(resolveResume(123, 0, []), { status: "wait" });
  assert.deepEqual(resolveResume(123, Infinity, []), { status: "wait" });
  assert.deepEqual(resolveResume(123, 300, []), { status: "wait" });
  assert.deepEqual(
    resolveResume(123, 300, [
      { start: 0, end: 60 },
      { start: 150, end: 300 },
    ]),
    { status: "wait" },
  );
  assert.deepEqual(
    resolveResume(123, 300, [
      { start: 0, end: 60 },
      { start: 90, end: 300 },
    ]),
    { status: "seek", position: 123 },
  );
});

test("新线路短于旧进度时从头开始，不把旧位置夹到片尾", () => {
  assert.deepEqual(resolveResume(300, 200, [{ start: 0, end: 200 }]), {
    status: "restart",
  });
  assert.deepEqual(resolveResume(200, 200, []), { status: "restart" });
  assert.deepEqual(resolveResume(199.8, 200, [{ start: 0, end: 200 }]), {
    status: "seek",
    position: 199.8,
  });
});

test("下一集按当前线路的原始集序处理，不排序，也不跨线或末集循环", () => {
  const first = episode("0:0", "特别篇"),
    second = episode("0:1", "第02集"),
    third = episode("0:2", "第01集");
  const film = {
    id: "film",
    name: "影片",
    poster: null,
    year: "",
    category: "",
    remarks: "",
    description: "",
    lines: [
      { name: "线路一", episodes: [first, second, third] },
      { name: "线路二", episodes: [episode("1:0", "第四集")] },
    ],
  };
  assert.deepEqual(nextEpisode(film, first.id), {
    status: "available",
    episode: second,
  });
  assert.deepEqual(nextEpisode(film, second.id), {
    status: "available",
    episode: third,
  });
  assert.deepEqual(nextEpisode(film, third.id), { status: "last" });
  assert.deepEqual(nextEpisode(film, "1:0"), { status: "last" });
  assert.deepEqual(nextEpisode(film, "unknown"), { status: "missing" });
});
test("紧邻下一项不可播放时停止，不跳过它去播后续可用集", () => {
  const first = episode("0:0", "第一集"),
    blocked = { ...episode("0:1", "第二集"), mime: null, reason: "分享页面" },
    third = episode("0:2", "第三集");
  const film = {
    id: "film",
    name: "影片",
    poster: null,
    year: "",
    category: "",
    remarks: "",
    description: "",
    lines: [{ name: "线路", episodes: [first, blocked, third] }],
  };
  assert.deepEqual(nextEpisode(film, first.id), {
    status: "unavailable",
    episode: blocked,
  });
});
