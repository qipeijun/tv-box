import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { MockAgent } from "undici";
import { createMediaProxy } from "./media-proxy.js";

async function fixture(t) {
  const dispatcher = new MockAgent(); dispatcher.disableNetConnect();
  const proxy = createMediaProxy({ dispatcher });
  const app = Fastify(); app.get("/api/media/:token", proxy.serve);
  app.addHook("onClose", async () => { await dispatcher.close(); });
  t.after(() => app.close());
  return { proxy, app, remote: dispatcher.get("https://media.example.com") };
}

test("HLS主清单、分片、密钥与初始化片段按最终地址改写，重复登记不耗尽令牌", async (t) => {
  const { proxy, app, remote } = await fixture(t);
  remote.intercept({ path: "/vod/master.m3u8" }).reply(200,
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin"\n#EXT-X-MAP:URI="init.mp4"\nchild/index.m3u8\n',
    { headers: { "content-type": "application/vnd.apple.mpegurl" } });
  const path = proxy.register("https://media.example.com/vod/master.m3u8");
  assert.equal(proxy.register("https://media.example.com/vod/master.m3u8"), path);
  const response = await app.inject(path);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes("https://"), false);
  const links = [...response.body.matchAll(/\/api\/media\/[a-f0-9-]+/g)].map(([value]) => value);
  assert.equal(links.length, 3);
  remote.intercept({ path: "/key.bin" }).reply(200, Buffer.from([1, 2, 3, 4]));
  assert.deepEqual((await app.inject(links[0])).rawPayload, Buffer.from([1, 2, 3, 4]));
  remote.intercept({ path: "/vod/child/index.m3u8" }).reply(200, "#EXTM3U\n#EXTINF:5,\nsegment.ts", { headers: { "content-type": "application/vnd.apple.mpegurl" } });
  const child = await app.inject(links[2]);
  assert.equal(child.statusCode, 200);
  assert.match(child.body, /#EXTINF:5,\n\/api\/media\//);
});

test("MP4 Range和专用上游头准确转发，保留206字节区间", async (t) => {
  const { proxy, app, remote } = await fixture(t);
  remote.intercept({ path: "/video.mp4", headers: { range: "bytes=4-7", referer: "https://site.example.com/" } })
    .reply(206, Buffer.from([4, 5, 6, 7]), { headers: { "content-range": "bytes 4-7/12", "accept-ranges": "bytes", "content-type": "video/mp4", "content-length": "4" } });
  const path = proxy.register("https://media.example.com/video.mp4", { referer: "https://site.example.com/" });
  const response = await app.inject({ url: path, headers: { range: "bytes=4-7" } });
  assert.equal(response.statusCode, 206);
  assert.equal(response.headers["content-range"], "bytes 4-7/12");
  assert.deepEqual(response.rawPayload, Buffer.from([4, 5, 6, 7]));
});

test("解析接口的无扩展名HLS和无类型子清单也逐层改写，不泄漏远端HTTP分片", async (t) => {
  const { proxy, app, remote } = await fixture(t);
  remote.intercept({ path: "/getM3u8" }).reply(200, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nchild", { headers: { "content-type": "application/octet-stream" } });
  const master = await app.inject(proxy.register("https://media.example.com/getM3u8", {}, { manifest: true }));
  assert.equal(master.headers["content-type"], "application/vnd.apple.mpegurl");
  const childPath = master.body.split("\n").at(-1);
  remote.intercept({ path: "/child" }).reply(200, "#EXTM3U\n#EXTINF:6,\nhttp://media.example.com/a.ts", { headers: { "content-type": "application/octet-stream" } });
  const child = await app.inject(childPath);
  assert.equal(child.statusCode, 200);
  assert.equal(child.body.includes("http://"), false);
  assert.match(child.body, /#EXTINF:6,\n\/api\/media\//);
});

test("媒体入口不能接收任意URL，清单及重定向不能转向私网", async (t) => {
  const { proxy, app, remote } = await fixture(t);
  assert.throws(() => proxy.register("http://127.0.0.1/secrets"));
  assert.throws(() => proxy.rewrite("#EXTM3U\nhttp://127.0.0.1/secrets", new URL("https://media.example.com/index.m3u8")));
  assert.equal((await app.inject("/api/media/unknown?url=https://media.example.com")).statusCode, 410);
  remote.intercept({ path: "/redirect" }).reply(302, "", { headers: { location: "http://127.0.0.1/secrets" } });
  const result = await app.inject(proxy.register("https://media.example.com/redirect"));
  assert.equal(result.statusCode, 422);
  assert.match(result.body, /不允许内网/);
});

test("已核实媒体端口可转发，但清单不能把端口授权带到其他主机", async (t) => {
  const { proxy, app } = await fixture(t);
  const origin = "http://111.170.9.17:9090";
  assert.throws(() => proxy.register(`${origin}/index.m3u8`));
  assert.throws(() => proxy.rewrite("#EXTM3U\nhttp://media.example.com:9090/a.ts", new URL(`${origin}/index.m3u8`), {}, [origin]));
  const dispatcher = new MockAgent(); dispatcher.disableNetConnect();
  const known = createMediaProxy({ dispatcher });
  t.after(() => dispatcher.close());
  dispatcher.get(origin).intercept({ path: "/index.m3u8" }).reply(200, "#EXTM3U\na.ts");
  const knownApp = Fastify(); knownApp.get("/api/media/:token", known.serve);
  t.after(() => knownApp.close());
  const response = await knownApp.inject(known.register(`${origin}/index.m3u8`, {}, { allowedOrigins: [origin] }));
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /\/api\/media\//);
  assert.equal((await app.inject("/api/media/unknown")).statusCode, 410);
});

test("长电影播放超过一小时后，尚未读取的后段分片沿用活动清单的有效期", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const { proxy, app, remote } = await fixture(t);
  remote.intercept({ path: "/movie.m3u8" }).reply(200, "#EXTM3U\nfirst.ts\nlast.ts");
  const manifest = await app.inject(proxy.register("https://media.example.com/movie.m3u8"));
  const links = manifest.body.split("\n").filter((line) => line.startsWith("/api/"));
  t.mock.timers.tick(50 * 60_000);
  remote.intercept({ path: "/first.ts" }).reply(200, "first");
  assert.equal((await app.inject(links[0])).body, "first");
  t.mock.timers.tick(50 * 60_000);
  remote.intercept({ path: "/last.ts" }).reply(200, "last");
  assert.equal((await app.inject(links[1])).body, "last");
  t.mock.timers.tick(61 * 60_000);
  assert.equal((await app.inject(links[1])).statusCode, 410);
});

test("账号媒体凭据不跟随跨域清单或重定向，退出撤销所有子资源且保留其他播放", async (t) => {
  const dispatcher = new MockAgent(); dispatcher.disableNetConnect();
  const proxy = createMediaProxy({ dispatcher });
  const app = Fastify(); app.get('/api/media/:token', proxy.serve);
  t.after(async () => { await app.close(); await dispatcher.close(); });
  const first = dispatcher.get('https://media.example.com'), other = dispatcher.get('https://cdn.example.com');
  first.intercept({ path: '/root.m3u8', headers: { cookie: 'TEST_SECRET' } }).reply(200, '#EXTM3U\nhttps://cdn.example.com/child.m3u8\nkey.bin');
  const path = proxy.register('https://media.example.com/root.m3u8', { Cookie: 'TEST_SECRET', Authorization: 'Bearer TEST' }, { owner: 'quark:login:file:' });
  const manifest = await app.inject(path);
  const links = manifest.body.split('\n').filter((line) => line.startsWith('/api/'));
  other.intercept({ path: '/child.m3u8' }).reply((options) => {
    assert.equal(Object.keys(options.headers).some((key) => /^(cookie|authorization)$/i.test(key)), false);
    return { statusCode: 200, data: '#EXTM3U\nsegment.ts' };
  });
  const child = await app.inject(links[0]); assert.equal(child.statusCode, 200);
  const segment = child.body.split('\n').at(-1);
  first.intercept({ path: '/redirect', headers: { cookie: 'TEST_SECRET' } }).reply(302, '', { headers: { location: 'https://cdn.example.com/dest.mp4' } });
  other.intercept({ path: '/dest.mp4' }).reply((options) => {
    assert.equal(Object.keys(options.headers).some((key) => /^cookie$/i.test(key)), false);
    return { statusCode: 200, data: 'video' };
  });
  assert.equal((await app.inject(proxy.register('https://media.example.com/redirect', { cookie: 'TEST_SECRET' }))).body, 'video');
  const unrelated = proxy.register('https://media.example.com/other.mp4', {}, { owner: 'quark:other:file:' });
  proxy.revoke('quark:login:');
  for (const resource of [path, ...links, segment]) assert.equal((await app.inject(resource)).statusCode, 410);
  first.intercept({ path: '/other.mp4' }).reply(200, 'unrelated');
  assert.equal((await app.inject(unrelated)).body, 'unrelated');
});
