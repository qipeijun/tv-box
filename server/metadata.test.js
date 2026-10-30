import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { SourceError } from "./remote.js";

const headers = { host: "127.0.0.1:4781", "x-tvbox-client": "web-v1" };
test("外部资料入参只允许平台与合法ID，拒绝任意URL及无页面标识请求", async (t) => {
  let calls = 0;
  const app = createApp({ logger: false, readJson: async () => { calls++; return {}; } });
  t.after(() => app.close());
  for (const path of ["/api/metadata/unknown/1", "/api/metadata/cinemeta/123", "/api/metadata/tvmaze/tt1"]) {
    assert.equal((await app.inject({ url: path, headers })).statusCode, 400);
  }
  assert.equal((await app.inject({ url: "/api/metadata/tvmaze/169" })).statusCode, 403);
  const search = (payload) => app.inject({ method: "POST", url: "/api/metadata/search", headers, payload });
  assert.equal((await search({ provider: "cinemeta", query: " " })).statusCode, 400);
  assert.equal((await search({ provider: "cinemeta", query: "x".repeat(121) })).statusCode, 400);
  assert.equal(calls, 0);
});

test("电影资料保留评分来源和真实缺失项，不携带播放入口；缓存合并重复请求", async (t) => {
  const calls = [];
  const app = createApp({ logger: false, readJson: async (url) => {
    calls.push(url);
    return { meta: { id: "tt0111161", type: "movie", name: "The Shawshank Redemption", year: "1994", imdbRating: "9.3", runtime: "142 min", cast: ["Tim Robbins"], poster: "javascript:alert(1)", videos: [{ url: "https://untrusted.test/media.mp4" }] } };
  } });
  t.after(() => app.close());
  const [one, two] = await Promise.all([app.inject({ url: "/api/metadata/cinemeta/tt0111161", headers }), app.inject({ url: "/api/metadata/cinemeta/tt0111161", headers })]);
  assert.equal(one.statusCode, 200); assert.deepEqual(one.json(), two.json());
  const value = one.json();
  assert.equal(value.rating, 9.3); assert.match(value.ratingLabel, /IMDb.*Cinemeta/);
  assert.equal(value.poster, null); assert.equal(value.background, null);
  assert.equal(value.cast[0].image, null); assert.equal(value.lines, undefined); assert.equal(value.videos, undefined);
  assert.equal(calls.length, 1);
});

test("搜索编码中文及路径字符，过滤错误媒体类型与非法评分", async (t) => {
  const calls = [];
  const app = createApp({ logger: false, readJson: async (url) => {
    calls.push(url);
    return { metas: [{ id: "tt1", name: "影片", type: "movie", year: "2025", imdbRating: "0" }, { id: "tt2", name: "剧集", type: "series" }] };
  } });
  t.after(() => app.close());
  const response = await app.inject({ method: "POST", url: "/api/metadata/search", headers, payload: { provider: "cinemeta", query: "影片/#?" } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().candidates.length, 1);
  assert.equal(response.json().candidates[0].rating, null);
  assert.equal(calls[0], "https://v3-cinemeta.strem.io/catalog/movie/top/search=%E5%BD%B1%E7%89%87%2F%23%3F.json");
});

test("剧集资料组合真实背景与演员；资料失败不改变播放API", async (t) => {
  const app = createApp({ logger: false, readJson: async (url) => {
    if (url.includes("/shows/7135?")) return { id: 7135, name: "Nirvana in Fire", premiered: "2015-09-19", rating: { average: 7.9 }, _embedded: { cast: [{ person: { name: "Wang Kai", image: { original: "https://static.tvmaze.com/actor.jpg" } }, character: { name: "Prince Jing" } }] } };
    if (url.endsWith("/7135/images")) return [{ type: "background", resolutions: { original: { url: "https://static.tvmaze.com/background.jpg" } } }];
    throw new SourceError("资料平台暂不可用", 502);
  } });
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/metadata/tvmaze/7135", headers });
  assert.equal(response.statusCode, 200); assert.match(response.json().attribution, /CC BY-SA/);
  assert.equal(response.json().cast[0].role, "Prince Jing"); assert.match(response.json().background, /background.jpg/);
  assert.equal((await app.inject({ url: "/api/metadata/tvmaze/1", headers })).statusCode, 502);
  assert.deepEqual((await app.inject({ url: "/api/health", headers })).json(), { ok: true });
});

test("远端返回了不同身份时拒绝作为已确认资料", async (t) => {
  const app = createApp({ logger: false, readJson: async () => ({ meta: { id: "tt2", name: "不同影片", type: "movie" } }) });
  t.after(() => app.close());
  assert.equal((await app.inject({ url: "/api/metadata/cinemeta/tt1", headers })).statusCode, 502);
});

test("剧集背景图失败保留评分与演员，错误作为资料提示返回", async (t) => {
  const app = createApp({ logger: false, readJson: async (url) => {
    if (url.endsWith("/images")) throw new SourceError("图片接口超时", 504);
    return { id: 1, name: "剧集", rating: { average: 8 }, _embedded: { cast: [] } };
  } });
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/metadata/tvmaze/1", headers });
  assert.equal(response.statusCode, 200); assert.equal(response.json().rating, 8);
  assert.equal(response.json().background, null); assert.match(response.json().warnings[0], /图片接口超时/);
});

test("只升级实测过的同片Metahub小海报路径，其他图片地址保持原样", async (t) => {
  const app = createApp({ logger: false, readJson: async () => ({ meta: { id: "tt1", name: "影片", type: "movie", poster: "https://images.metahub.space/poster/small/tt1/img" } }) });
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/metadata/cinemeta/tt1", headers });
  assert.equal(response.json().poster, "https://images.metahub.space/poster/large/tt1/img");
});
