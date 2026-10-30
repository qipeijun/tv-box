import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseSubscription, parseCms } from "./sources.js";
import { reboRequest, reboDetail, reboPlay } from "./adapters/fantaiying.js";
import { validateRemoteUrl } from "./remote.js";

test("饭太硬已实现适配与未知插件区分，T4保留原站点身份及真实接口", () => {
  const [site, unknown] = parseSubscription({ sites: [
    { key: "光影", name: "光影", type: 3, api: "csp_T4Guard", ext: JSON.stringify({ siteUrl: "https://example.com/api", categories: ["国产剧"] }) },
    { key: "unknown", name: "未知", type: 3, api: "csp_UnknownGuard" },
  ] });
  assert.equal(site.supported, true);
  assert.equal(site.api, "csp_T4Guard");
  assert.equal(site.requestApi, "https://example.com/api");
  assert.equal(site.adapter, "cms");
  assert.equal(unknown.supported, false);
  const [bad] = parseSubscription({ sites: [{ key: "bad", name: "bad", type: 3, api: "csp_T4Guard", ext: '{"siteUrl":"http://127.0.0.1/api"}' }] });
  assert.equal(bad.supported, false);
});

test("热播请求采用已确认multipart签名，异常响应不冒充空结果", async () => {
  const site = { requestApi: "https://example.com" };
  const result = await reboRequest(site, "home/search", { keyword: "庆余年" }, async (url, options) => {
    assert.equal(url, "https://example.com/v3/home/search");
    assert.equal(options.method, "POST");
    const timestamp = options.body.match(/name="timestamp"\r\n\r\n(\d+)/)[1];
    const sign = createHash("md5").update("7gp0bnd2sr85ydii2j32pcypscoc4w6c7g5spl" + timestamp).digest("hex");
    assert.ok(options.body.includes(sign));
    assert.ok(options.body.includes("庆余年"));
    return { data: { list: [] } };
  });
  assert.deepEqual(result, { list: [] });
  await assert.rejects(reboRequest(site, "home/search", {}, async () => ({ msg: "签名失效" })), /签名失效/);
});

test("热播集数保留非URL播放标识与真实集序，解析时沿用对应请求头", async () => {
  const detail = await reboDetail({ requestApi: "https://example.com" }, "54444", async () => ({ data: {
    vod_name: "真实格式样本", vod_play_list: [{ name: "线路二", ua: "sample-agent", parse_urls: [], urls: [{ name: "第02集", url: "https://media.example.com/second.m3u8" }] }],
  } }));
  const episode = parseCms(detail, true, true)[0].lines[0].episodes[0];
  assert.equal(episode.name, "第02集");
  assert.equal(episode.id, "0:0");
  assert.equal(episode.needsResolve, true);
  const media = await reboPlay(episode.playbackId, async () => { throw Error("直链不能请求解析服务"); });
  assert.equal(media.url, "https://media.example.com/second.m3u8");
  assert.deepEqual(media.headers, { "user-agent": "sample-agent" });
});

test("非标准端口仅通过显式适配契约放行，内网仍被拒绝", () => {
  assert.throws(() => validateRemoteUrl("https://example.com:7788/api"));
  assert.equal(validateRemoteUrl("https://example.com:7788/api", { allowedPorts: ["7788"] }).port, "7788");
  assert.throws(() => validateRemoteUrl("http://127.0.0.1:7788/api", { allowedPorts: ["7788"] }));
});

test("热播解析节点轮换公网媒体IP时按当前origin授权，不接受私网或未知端口", async () => {
  const raw = (parser) => Buffer.from(JSON.stringify({ url: "episode-token", parses: [parser], ua: "" })).toString("base64url");
  const parser = "https://api.nbyjson.top:7788/api/?url=";
  const media = await reboPlay(raw(parser), async (url, options) => {
    assert.equal(new URL(url).origin, "https://api.nbyjson.top:7788");
    assert.deepEqual(options.allowedPorts, ["7788"]);
    return { url: "http://43.248.96.62:9090/nby/m3u8/getM3u8?id=sample" };
  });
  assert.deepEqual(media.allowedOrigins, ["http://43.248.96.62:9090"]);
  await assert.rejects(reboPlay(raw(parser), async () => ({ url: "http://127.0.0.1:9090/a" })), /不允许内网/);
  await assert.rejects(reboPlay(raw(parser), async () => ({ url: "http://43.248.96.62:9091/a" })), /标准端口/);
  await assert.rejects(reboPlay(raw("https://unknown.example.com/?url="), async () => ({ url: "http://43.248.96.62:9090/a" })), /标准端口/);
});
