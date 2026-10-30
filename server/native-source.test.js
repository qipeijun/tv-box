import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { createApp } from "./app.js";
import { SourceError } from "./remote.js";

const headers = { host: "127.0.0.1:4781", "x-tvbox-client": "web-v1" };
const configUrl = "https://config.example.com/fty.json";
const config = { sites: [{ key: "rebo", name: "热播", type: 3, api: "csp_AppTTGuard", ext: "https://rebo.example.com" }] };
const detail = { data: { vod_name: "签名接口样本", vod_play_list: [{ name: "普通线路", urls: [
  { name: "第1集", url: "https://media.example.com/first.m3u8" },
  { name: "第2集", url: "https://media.example.com/second.m3u8" },
] }] } };
async function open(app) {
  return (await app.inject({ method: "POST", url: "/api/subscriptions", headers, payload: { url: configUrl } })).json();
}

test("原生站点详情不泄漏解析标识，选集接口只解析服务器快照中的原集序", async (t) => {
  const calls = [];
  const app = createApp({ logger: false, readJson: async (url, options) => {
    calls.push({ url, options });
    if (url === configUrl) return config;
    if (url === "https://rebo.example.com/v3/home/vod_details") return detail;
    throw Error("出现未经登记的上游请求");
  } });
  t.after(() => app.close());
  const sub = await open(app);
  const base = `/api/subscriptions/${sub.id}/sites/rebo/videos/7`;
  const film = (await app.inject({ url: base, headers })).json().film;
  assert.equal(film.lines[0].episodes[1].id, "0:1");
  assert.equal(film.lines[0].episodes[1].url, `${base}/play`);
  assert.equal(film.lines[0].episodes[1].needsResolve, true);
  assert.equal("playbackId" in film.lines[0].episodes[1], false);
  assert.equal(JSON.stringify(film).includes("media.example.com"), false);
  const selected = await app.inject({ method: "POST", url: `${base}/play`, headers, payload: { line: 0, episode: 1 } });
  assert.equal(selected.statusCode, 200);
  assert.match(selected.json().url, /^\/api\/media\//);
  assert.equal(selected.json().mime, "application/x-mpegURL");
  assert.ok(calls.at(-1).options.signal instanceof AbortSignal);
  assert.equal((await app.inject({ method: "POST", url: `${base}/play`, headers, payload: { line: 0, episode: 100 } })).statusCode, 404);
  const count = calls.length;
  assert.equal((await app.inject({ method: "POST", url: `${base}/play`, headers, payload: { url: "http://127.0.0.1/secrets" } })).statusCode, 400);
  assert.equal(calls.length, count);
});

test("离开当前集会取消后端正在等待的解析链路", { timeout: 4000 }, async (t) => {
  let arrivedResolve, cancelledResolve;
  const arrived = new Promise((resolve) => { arrivedResolve = resolve; });
  const cancelled = new Promise((resolve) => { cancelledResolve = resolve; });
  const app = createApp({ logger: false, readJson: async (url, options) => {
    if (url === configUrl) return config;
    arrivedResolve();
    return new Promise((_, reject) => options.signal.addEventListener("abort", () => {
      cancelledResolve(); reject(new SourceError("本次源请求已取消。", 499));
    }, { once: true }));
  } });
  t.after(() => app.close());
  const sub = await open(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const req = request({ hostname: "127.0.0.1", port: app.server.address().port,
    path: `/api/subscriptions/${sub.id}/sites/rebo/videos/7/play`, method: "POST",
    headers: { ...headers, "content-type": "application/json" },
  });
  req.on("error", () => {});
  req.end(JSON.stringify({ line: 0, episode: 0 }));
  await arrived;
  req.destroy();
  await cancelled;
  assert.equal(req.destroyed, true);
});
