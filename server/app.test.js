import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { SourceError } from "./remote.js";

const headers = { host: "127.0.0.1:4781", "x-tvbox-client": "web-v1" };
const config = {
  sites: [
    {
      key: "cms",
      name: "接口",
      type: 1,
      api: "https://example.com/vod?ac=list",
    },
    { key: "spider", name: "爬虫", type: 3, api: "csp_demo" },
  ],
};
const film = {
  vod_id: 7,
  vod_name: "样本影片",
  vod_play_from: "hls",
  vod_play_url: "第1集$https://example.com/1.m3u8",
};

test("订阅更新失败保留旧会话，配置改变创建独立快照，移除只释放对应本机订阅", async (t) => {
  let configData = config;
  const app = createApp({
    logger: false,
    readJson: async (url) =>
      url === "https://example.com/config"
        ? configData
        : { code: 1, list: [film] },
  });
  t.after(() => app.close());
  const open = () =>
    app.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers,
      payload: { url: "https://example.com/config" },
    });
  const first = (await open()).json();
  configData = { sites: [] };
  assert.equal((await open()).statusCode, 422);
  const oldPath = `/api/subscriptions/${first.id}/sites/cms/videos`;
  assert.equal((await app.inject({ url: oldPath, headers })).statusCode, 200);
  configData = { sites: [{ ...config.sites[0], key: "new", name: "新来源" }] };
  const changed = (await open()).json();
  assert.notEqual(changed.id, first.id);
  assert.notEqual(changed.revision, first.revision);
  assert.equal((await app.inject({ url: oldPath, headers })).statusCode, 200);
  assert.equal(
    (
      await app.inject({
        url: `/api/subscriptions/${changed.id}/sites/new/videos`,
        headers,
      })
    ).statusCode,
    200,
  );
  const removed = await app.inject({
    method: "DELETE",
    url: "/api/subscriptions",
    headers,
    payload: { url: "https://example.com/config" },
  });
  assert.equal(removed.statusCode, 200);
  assert.equal((await app.inject({ url: oldPath, headers })).statusCode, 410);
  assert.equal(
    (
      await app.inject({
        url: `/api/subscriptions/${changed.id}/sites/new/videos`,
        headers,
      })
    ).statusCode,
    410,
  );
});

test("分类与列表分页 API 传递真实参数，无效分页不请求上游，指纹不依赖服务实例", async (t) => {
  const urls = [];
  const options = {
    logger: false,
    readJson: async (url) => {
      urls.push(url);
      return url === "https://example.com/config"
        ? config
        : {
            code: 1,
            class: [{ type_id: 13, type_name: "国产剧" }],
            page: "2",
            pagecount: 3,
            total: 50,
            list: [],
          };
    },
  };
  const app = createApp(options);
  const secondApp = createApp(options);
  t.after(async () => {
    await app.close();
    await secondApp.close();
  });
  const payload = { url: "https://example.com/config" };
  const first = (
    await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers,
      payload,
    })
  ).json();
  const second = (
    await secondApp.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers,
      payload,
    })
  ).json();
  assert.notEqual(first.id, second.id);
  assert.equal(first.revision, second.revision);
  const base = `/api/subscriptions/${first.id}/sites/cms`;
  const categories = await app.inject({ url: `${base}/categories`, headers });
  assert.equal(categories.json().categories[0].id, "13");
  assert.equal(new URL(urls.at(-1)).searchParams.get("ac"), "list");
  const page = await app.inject({
    url: `${base}/videos?category=13&page=2`,
    headers,
  });
  assert.deepEqual(page.json().pagination, { page: 2, pages: 3, total: 50 });
  assert.equal(new URL(urls.at(-1)).searchParams.get("t"), "13");
  assert.equal(new URL(urls.at(-1)).searchParams.get("pg"), "2");
  const count = urls.length;
  for (const query of [
    "page=0",
    "page=2.5",
    "page=100001",
    "category=%3Cbad%3E",
  ])
    assert.equal(
      (await app.inject({ url: `${base}/videos?${query}`, headers }))
        .statusCode,
      400,
    );
  assert.equal(urls.length, count);
});

test("导入订阅到读取影片及集数的完整 API 链路，不暴露任意接口代理", async (t) => {
  const requested = [];
  const app = createApp({
    logger: false,
    readJson: async (url) => {
      requested.push(url);
      return url === "https://example.com/config"
        ? config
        : { code: 1, list: [film] };
    },
  });
  t.after(() => app.close());
  const imported = await app.inject({
    method: "POST",
    url: "/api/subscriptions",
    headers,
    payload: { url: "https://example.com/config" },
  });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.headers["cache-control"], "no-store");
  const subscription = imported.json();
  assert.equal(subscription.sites[1].supported, false);
  assert.equal(subscription.sites[0].api, undefined);
  const base = `/api/subscriptions/${subscription.id}/sites/cms/videos`;
  const catalog = await app.inject({ url: base, headers });
  assert.equal(catalog.json().films[0].name, "样本影片");
  assert.equal(catalog.json().films[0].lines, undefined);
  const detail = await app.inject({ url: `${base}/7`, headers });
  assert.equal(
    detail.json().film.lines[0].episodes[0].mime,
    "application/x-mpegURL",
  );
  assert.equal(new URL(requested.at(-1)).searchParams.get("ids"), "7");
  assert.equal(
    (await app.inject({ url: base.replace("/cms/", "/spider/"), headers }))
      .statusCode,
    422,
  );
  assert.equal(
    (await app.inject({ url: base.replace("/cms/", "/unknown/"), headers }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: `${base}/7,8`, headers })).statusCode,
    400,
  );
});

test("拒绝跨域页面、未知 Host 与缺少页面标识的请求", async (t) => {
  let reads = 0;
  const app = createApp({
    logger: false,
    readJson: async () => {
      reads++;
      return config;
    },
  });
  t.after(() => app.close());
  for (const invalid of [
    { host: "evil.example", "x-tvbox-client": "web-v1" },
    { host: "127.0.0.1:4781" },
    { ...headers, origin: "https://evil.example" },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers: invalid,
      payload: { url: "https://example.com/config" },
    });
    assert.equal(response.statusCode, 403);
  }
  assert.equal(reads, 0);
});

test("过期会话、无效输入与上游错误具有可恢复的错误响应", async (t) => {
  const app = createApp({
    logger: false,
    readJson: async () => {
      throw new SourceError("源返回 HTTP 403", 502);
    },
  });
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        url: "/api/subscriptions/missing/sites/cms/videos",
        headers,
      })
    ).statusCode,
    410,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/subscriptions",
        headers,
        payload: { url: "wrong" },
      })
    ).statusCode,
    400,
  );
  const response = await app.inject({
    method: "POST",
    url: "/api/subscriptions",
    headers,
    payload: { url: "https://example.com/config" },
  });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error, "源返回 HTTP 403");
});

test("默认内置片库无需依赖外部订阅服务器，重复打开不会耗尽会话", async (t) => {
  const app = createApp({
    logger: false,
    readJson: async () => {
      throw Error("不应读取远端配置");
    },
  });
  t.after(() => app.close());
  const index = await app.inject({ url: "/api/builtins", headers });
  assert.equal(index.json().subscriptions[0].id, "curated");
  let previous;
  for (let count = 0; count < 20; count++) {
    const response = await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers,
      payload: { builtinId: "curated" },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(response.json().sites.length >= 2);
    if (previous) assert.equal(response.json().id, previous);
    previous = response.json().id;
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/subscriptions",
        headers,
        payload: { builtinId: "unknown" },
      })
    ).statusCode,
    404,
  );
});

test("影片搜索传递已核实的 CMS wd 参数，超长搜索词不发往上游", async (t) => {
  const urls = [];
  const app = createApp({
    logger: false,
    readJson: async (url) => {
      urls.push(url);
      return url === "https://example.com/config"
        ? config
        : { code: 1, list: [] };
    },
  });
  t.after(() => app.close());
  const subscription = (
    await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers,
      payload: { url: "https://example.com/config" },
    })
  ).json();
  const base = `/api/subscriptions/${subscription.id}/sites/cms/videos`;
  assert.equal(
    (
      await app.inject({
        url: `${base}?search=${encodeURIComponent("太平年")}`,
        headers,
      })
    ).statusCode,
    200,
  );
  assert.equal(new URL(urls.at(-1)).searchParams.get("wd"), "太平年");
  const before = urls.length;
  assert.equal(
    (await app.inject({ url: `${base}?search=${"x".repeat(101)}`, headers }))
      .statusCode,
    400,
  );
  assert.equal(urls.length, before);
});

test("搜索能力遵循配置明确开关，默认标准 CMS 可搜索；禁用来源仍可浏览，不请求被禁用的搜索", async (t) => {
  const calls = [];
  const app = createApp({
    logger: false,
    readJson: async (url, options) => {
      calls.push({ url, signal: options?.signal });
      return url === "https://example.com/config"
        ? {
            sites: [
              { ...config.sites[0], key: "off", searchable: "0" },
              { ...config.sites[0], key: "default" },
              { ...config.sites[0], key: "on", searchable: 2 },
              config.sites[1],
            ],
          }
        : { code: 1, list: [film] };
    },
  });
  t.after(() => app.close());
  const sub = (
    await app.inject({
      method: "POST",
      url: "/api/subscriptions",
      headers,
      payload: { url: "https://example.com/config" },
    })
  ).json();
  assert.deepEqual(
    sub.sites.map((site) => site.searchable),
    [false, true, true, false],
  );
  assert.equal("api" in sub.sites[0], false);
  const endpoint = (key) => `/api/subscriptions/${sub.id}/sites/${key}/videos`;
  const before = calls.length;
  assert.equal(
    (await app.inject({ url: `${endpoint("off")}?search=test`, headers }))
      .statusCode,
    422,
  );
  assert.equal(calls.length, before);
  assert.equal(
    (await app.inject({ url: endpoint("off"), headers })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: `${endpoint("default")}?search=test`, headers }))
      .statusCode,
    200,
  );
  assert.ok(calls.at(-1).signal instanceof AbortSignal);
});

test(
  "浏览器取消列表请求会传递到上游读取，释放在途请求",
  { timeout: 4000 },
  async (t) => {
    const { request } = await import("node:http");
    let arrivedResolve, cancelledResolve;
    const arrived = new Promise((resolve) => (arrivedResolve = resolve));
    const cancelled = new Promise((resolve) => (cancelledResolve = resolve));
    const app = createApp({
      logger: false,
      readJson: async (url, options) => {
        if (url === "https://example.com/config") return config;
        arrivedResolve();
        return new Promise((_, reject) =>
          options.signal.addEventListener(
            "abort",
            () => {
              cancelledResolve();
              reject(new SourceError("取消", 499));
            },
            { once: true },
          ),
        );
      },
    });
    t.after(() => app.close());
    const sub = (
      await app.inject({
        method: "POST",
        url: "/api/subscriptions",
        headers,
        payload: { url: "https://example.com/config" },
      })
    ).json();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = app.server.address().port;
    const req = request({
      hostname: "127.0.0.1",
      port,
      path: `/api/subscriptions/${sub.id}/sites/cms/videos?search=test`,
      headers,
    });
    req.on("error", () => {});
    req.end();
    await arrived;
    req.destroy();
    await cancelled;
    assert.equal(req.destroyed, true);
  },
);
