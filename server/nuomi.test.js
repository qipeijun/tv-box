import test from "node:test";
import assert from "node:assert/strict";
import { nuomiPage, nuomiDetail, nuomiPlay, scriptString, NUOMI_ORIGIN } from "./adapters/nuomi.js";
import { parseCms, parseSubscription } from "./sources.js";
import { createApp } from "./app.js";

const site = { requestApi: NUOMI_ORIGIN };
const listing = '<nav id="topnav"></nav><ul class="resize_list"><li><a href="/vod-detail-id-7.html" title="样本"><img src="/cover.jpg"><span class="sBottom"><span>更新2集<em>8.0</em></span></span></a></li></ul><div class="page">共31条数据 当前:2/3页</div>';
const detail = '<h1 class="type-title">国产剧</h1><section class="content"><img src="/cover.jpg"><h1 class="title">原站影片</h1><div class="desc_item"><span>主演:&nbsp;</span>甲 乙</div><div class="desc_item"><span>年代:&nbsp;</span>2026</div></section>';
const player = "<script>mac_from='xiguam3u8$$$lzm3u8',mac_url='第02集$https://media.example.com/2.m3u8#第01集$https://media.example.com/1.m3u8$$$第02集$https://other.example.com/2.m3u8';</script>";

test("糯米页面列表保留真实分页、详情线路和原始集序，搜索关闭不冒充空结果", async () => {
  const p = await nuomiPage(site, { category: "12", page: 2 }, async (url, options) => {
    assert.ok(url.includes("vod-list-id-12-pg-2-"));
    assert.deepEqual(options.allowedPorts, ["5200"]);
    assert.ok(options.headers["user-agent"].includes("Android"));
    return listing;
  });
  assert.equal(p.page, 2); assert.equal(p.pagecount, 3); assert.equal(p.total, 31);
  assert.equal(p.list[0].vod_remarks, "更新2集");
  const data = await nuomiDetail(site, "7", async (url) => url.includes("vod-detail") ? detail : player);
  const film = parseCms(data, true, true)[0];
  assert.deepEqual(film.lines.map((line) => line.name), ["xiguam3u8", "lzm3u8"]);
  assert.deepEqual(film.lines[0].episodes.map((e) => e.name), ["第02集", "第01集"]);
  assert.equal(film.actors, "甲 乙");
  await assert.rejects(nuomiPage(site, { search: "庆余年", page: 1 }, async () => { throw Error("不能发起上游搜索"); }), /关闭搜索/);
  await assert.rejects(nuomiDetail(site, "7", async () => ""), /未返回有效内容/);
});

test("糯米仅提取已知字符串数据并走实际线路播放器，不执行页面表达式", async () => {
  const data = await nuomiDetail(site, "7", async (url) => url.includes("vod-detail") ? detail : player);
  const film = parseCms(data, true, true)[0];
  const calls = [];
  const media = await nuomiPlay(site, film.lines[1].episodes[0].playbackId, async (url, options) => {
    calls.push(url);
    if (url.endsWith("/player/lzm3u8.js")) return "MacPlayer.Html='<iframe src=\"https://api.wwgz.cn:520/player/?url='+MacPlayer.PlayUrl+'\"></iframe>';";
    assert.deepEqual(options.allowedPorts, ["520"]);
    return '<script>var config={"url":"https://cdn.example.com/video.m3u8"};</script>';
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("https://other.example.com/2.m3u8"));
  assert.equal(media.url, "https://cdn.example.com/video.m3u8");
  assert.ok(media.headers.referer.startsWith("https://api.wwgz.cn:520/"));
  assert.equal(scriptString("mac_url='第01集$https://a.example.com/it\\'s.m3u8'", "mac_url"), "第01集$https://a.example.com/it's.m3u8");
  assert.throws(() => scriptString("mac_url=globalThis.attack()", "mac_url"), /缺少 mac_url/);
  await assert.rejects(nuomiPlay(site, film.lines[0].episodes[0].playbackId, async (url) => url.endsWith(".js")
    ? "MacPlayer.Html='<iframe src=\"http://127.0.0.1/?url='+MacPlayer.PlayUrl;" : ""), /不允许内网/);
});

test("糯米贯通订阅、分类、详情和按集解析API，原站身份与解析凭据留在后端", async (t) => {
  const config = { sites: [{ key: "糯米", name: "糯米", type: 3, api: "csp_NmyswvGuard" }] };
  assert.equal(parseSubscription(config)[0].searchable, 0);
  const app = createApp({ logger: false, readJson: async () => config, readText: async (url) => {
    if (url === `${NUOMI_ORIGIN}/`) return '<div id="topnav"><a href="/vod-type-id-12-pg-1.html">国产剧</a></div>';
    if (url.includes("vod-detail")) return detail;
    if (url.includes("vod-play")) return player;
    if (url.endsWith(".js")) return "MacPlayer.Html='<iframe src=\"https://api.wwgz.cn:520/player/?url='+MacPlayer.PlayUrl;";
    if (url.startsWith("https://api.wwgz.cn:520/")) return '{"url":"https://media.example.com/a.m3u8"}';
    return listing;
  } });
  t.after(() => app.close());
  const headers = { host: "127.0.0.1:4781", "x-tvbox-client": "web-v1" };
  const sub = (await app.inject({ method: "POST", url: "/api/subscriptions", headers, payload: { url: "https://config.example.com" } })).json();
  assert.equal(sub.sites[0].supported, true); assert.equal(sub.sites[0].searchable, false);
  const base = `/api/subscriptions/${sub.id}/sites/${encodeURIComponent("糯米")}`;
  assert.deepEqual((await app.inject({ url: `${base}/categories`, headers })).json().categories, [{ id: "12", name: "国产剧" }]);
  const film = (await app.inject({ url: `${base}/videos/7`, headers })).json().film;
  assert.equal(film.lines[1].episodes[0].playbackId, undefined);
  assert.equal(film.lines[1].episodes[0].needsResolve, true);
  const selected = await app.inject({ method: "POST", url: film.lines[1].episodes[0].url, headers, payload: { line: 1, episode: 0 } });
  assert.equal(selected.statusCode, 200);
  assert.match(selected.json().url, /^\/api\/media\//);
});
