import test from "node:test";
import assert from "node:assert/strict";
import { trailerAdapter } from "./adapters/trailers.js";
import { parseCms, parseSubscription } from "./sources.js";

const detail = '<h1 class="movie-name">原片名 <span>English</span></h1><div id="tabwrapper-all"><table><tr><td><a class="tlist-bbs-tdtitle">定档预告</a><a class="tlist-btn" href="/download/19">下载</a></td></tr><tr><td><a class="tlist-bbs-tdtitle">首支预告</a><a class="tlist-btn" href="/download/7">下载</a></td></tr></table></div>';

test("荐影预告片保留页面条目顺序和数字身份，不伪装成正片或任意路径", async () => {
  assert.equal(parseSubscription({ sites: [{ key: "YGP", name: "荐影", type: 3, api: "csp_YGPGuard", searchable: 0 }] })[0].adapter, "trailers");
  const calls = [];
  const io = { text: async (url) => { calls.push(url); return detail; }, json: async (url) => {
    calls.push(url); return [{ movurl: "https://cdn.example.com/trailer.mp4" }];
  } };
  const film = parseCms(await trailerAdapter.detail({}, "15789", io), true, true)[0];
  assert.equal(film.name, "原片名"); assert.equal(film.category, "电影预告片");
  assert.deepEqual(film.lines[0].episodes.map((e) => e.name), ["定档预告", "首支预告"]);
  const media = await trailerAdapter.play({}, film.lines[0].episodes[1].playbackId, io);
  assert.equal(media.url, "https://cdn.example.com/trailer.mp4");
  assert.equal(new URL(calls.at(-1)).searchParams.get("ttid"), "7");
  await assert.rejects(trailerAdapter.detail({}, "../private", io), /编号无效/);
  await assert.rejects(trailerAdapter.play({}, film.lines[0].episodes[0].playbackId, { json: async () => [{ movurl: "http://127.0.0.1/private.mp4" }] }), /不允许内网/);
});

test("荐影分页取实际页数，空预告和未知页面保留真实语义", async () => {
  const listing = '<div class="inner-2col-main"><div class="movlist"><ul><li><a href="/movie/7"><img src="/p.jpg"><span title="影片"></span></a></li></ul></div></div><p class="page-nav"><a href="/allmovies/3">3</a></p>';
  const page = await trailerAdapter.page({}, { category: "allmovies", page: 2 }, { text: async (url) => {
    assert.equal(url, "https://www.6huo.com/allmovies/2"); return listing;
  } });
  assert.equal(page.page, 2); assert.equal(page.pagecount, 3);
  assert.equal(page.list[0].vod_id, "7");
  assert.equal(page.total, undefined);
  const noClips = parseCms(await trailerAdapter.detail({}, "7", { text: async () => '<h1 class="movie-name">暂无预告的电影</h1>' }), true, true)[0];
  assert.deepEqual(noClips.lines, []);
  await assert.rejects(trailerAdapter.page({}, { page: 1 }, { text: async () => "验证页面" }), /未返回已核实/);
});
