import { test } from "node:test";
import assert from "node:assert/strict";
import { parseM3u, subscriptionLiveEntries } from "./live.js";
import { createApp } from "./app.js";
import { SourceError } from "./remote.js";

test("M3U 名称、带逗号分组、台标与相对地址按数据解析，缺失信息不伪造", () => {
  const channels = parseM3u(
    '\uFEFF#EXTM3U\r\n#EXTINF:-1 group-title="新闻,国际" tvg-logo="./logo.png",真实频道,高清\r\n./one.m3u8?token=a\r\n#EXTINF:-1,无分组\n#EXTGRP:纪实\nhttps://media.example.com/two.m3u8',
    "https://example.com/live/channels.m3u",
  );
  assert.equal(channels.length, 2);
  assert.equal(channels[0].name, "真实频道,高清");
  assert.equal(channels[0].group, "新闻,国际");
  assert.equal(channels[0].logo, "https://example.com/live/logo.png");
  assert.equal(channels[0].url, "https://example.com/live/one.m3u8?token=a");
  assert.equal(channels[1].group, "纪实");
  assert.equal(channels[1].logo, null);
  assert.equal(channels[1].mime, "application/x-mpegURL");
  assert.equal(
    channels[0].id,
    parseM3u(
      "#EXTM3U\n#EXTINF:-1,真实频道,高清\n./one.m3u8?token=a",
      "https://example.com/live/channels.m3u",
    )[0].id,
  );
});

test("视频分片清单、空列表和错误结构不当成频道列表", () => {
  for (const text of [
    "<html>错误</html>",
    "#EXTM3U\n",
    "#EXTM3U\n#EXTINF:-1 无名称\nhttps://example.com/1.m3u8",
  ])
    assert.throws(() => parseM3u(text));
  for (const tag of [
    "#EXT-X-TARGETDURATION:10",
    "#EXT-X-STREAM-INF:BANDWIDTH=123",
    "#EXT-X-MEDIA-SEQUENCE:42",
  ])
    assert.throws(
      () => parseM3u(`#EXTM3U\n${tag}\nhttps://example.com/video.m3u8`),
      /视频清单/,
    );
});

test("原生协议、内网、专用头和未知格式频道保留不支持原因，不交给网页播放器", () => {
  const channels = parseM3u(
    "#EXTM3U\n#EXTINF:-1,内网\nhttp://127.0.0.1/1.m3u8\n#EXTINF:-1,原生\nrtsp://example.com/live\n#EXTINF:-1,专用头\n#EXTVLCOPT:http-referrer=https://example.com\nhttps://example.com/1.m3u8\n#EXTINF:-1,未知格式\nhttps://example.com/live.flv",
  );
  assert.equal(channels.length, 4);
  assert.ok(channels.every((channel) => channel.reason && !channel.mime));
  assert.equal(channels[0].url, null);
  assert.match(channels[2].reason, /专用请求头/);
});

test("TVBox lives 只开放确认过的标准入口，原生代理与附加头不冒充可用 M3U", () => {
  const entries = subscriptionLiveEntries({
    lives: [
      { name: "标准", type: 0, url: "https://example.com/list.m3u" },
      { name: "原生代理", url: "http://127.0.0.1:9978/proxy" },
      {
        name: "特定客户端",
        type: 0,
        url: "https://example.com/1.m3u",
        ua: "TVBox",
      },
      { name: "内网", type: 0, url: "http://10.0.0.1/list.m3u" },
    ],
  });
  assert.deepEqual(
    entries.map((entry) => entry.supported),
    [true, false, false, false],
  );
  assert.deepEqual(subscriptionLiveEntries({}), []);
});

test("直播 API 内置与自定义路径、订阅归属和失效错误可核验，不提供任意代理", async (t) => {
  const headers = { host: "127.0.0.1:4781", "x-tvbox-client": "web-v1" };
  const calls = [];
  const app = createApp({
    logger: false,
    readText: async (url) => {
      calls.push(url);
      if (url.endsWith("error.m3u"))
        throw new SourceError("直播源返回 HTTP 502", 502);
      return '#EXTM3U\n#EXTINF:-1 group-title="新闻",频道\nhttps://example.com/live.m3u8';
    },
    readJson: async () => ({
      sites: [
        { key: "vod", name: "点播", type: 1, api: "https://example.com/vod" },
      ],
      lives: [{ name: "直播", type: 0, url: "https://example.com/list.m3u" }],
    }),
  });
  t.after(() => app.close());
  const request = (payload) =>
    app.inject({
      method: "POST",
      url: "/api/live/playlists",
      headers,
      payload,
    });
  const featured = await request({ builtinId: "featured" });
  assert.equal(featured.statusCode, 200);
  assert.equal(featured.json().channels.length, 3);
  assert.equal(calls.length, 0);
  const custom = await request({ url: "https://example.com/list.m3u" });
  assert.equal(custom.json().channels[0].name, "频道");
  assert.equal(calls.at(-1), "https://example.com/list.m3u");
  const subscription = (
    await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers,
      payload: { url: "https://example.com/config" },
    })
  ).json();
  assert.equal(subscription.livePlaylists[0].url, undefined);
  assert.equal(
    (await request({ subscriptionId: subscription.id, playlistId: "0" }))
      .statusCode,
    200,
  );
  assert.equal(
    (await request({ subscriptionId: "expired", playlistId: "0" })).statusCode,
    410,
  );
  assert.equal(
    (await request({ subscriptionId: subscription.id, playlistId: "other" }))
      .statusCode,
    404,
  );
  assert.equal((await request({ builtinId: "unknown" })).statusCode, 404);
  assert.equal((await request({ url: "wrong" })).statusCode, 400);
  assert.equal(
    (await request({ url: "https://example.com/error.m3u" })).json().error,
    "直播源返回 HTTP 502",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/live/playlists",
        payload: { builtinId: "featured" },
      })
    ).statusCode,
    403,
  );
});
