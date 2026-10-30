import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cmsUrl,
  cmsCategoriesUrl,
  parseCategories,
  parseCmsPage,
  parseCms,
  parseSubscription,
} from "./sources.js";
import {
  isPublicAddress,
  readRemoteJson,
  validateRemoteUrl,
  decodeRemoteJson,
} from "./remote.js";

test("真实 CMS class 的层级与平铺形状均可解析，缺失分类不推造分类", () => {
  assert.deepEqual(
    parseCategories({
      code: 1,
      class: [
        { type_id: 1, type_pid: 0, type_name: "电影片" },
        { type_id: "6", type_pid: 1, type_name: "动作片" },
      ],
    }),
    [
      { id: "1", parentId: "0", name: "电影片" },
      { id: "6", parentId: "1", name: "动作片" },
    ],
  );
  assert.equal(
    parseCategories({
      code: 1,
      class: [{ type_id: 13, type_name: "国产剧" }],
    })[0].parentId,
    undefined,
  );
  assert.deepEqual(parseCategories({ code: 1, list: [] }), []);
  assert.throws(
    () =>
      parseCategories({
        code: 1,
        class: [
          { type_id: 1, type_name: "甲" },
          { type_id: 1, type_name: "乙" },
        ],
      }),
    /重复/,
  );
});

test("分页兼容实际数字和数字字符串，空结果与缺失元信息保持真实语义", () => {
  const result = parseCmsPage({
    code: 1,
    list: [],
    page: "2",
    pagecount: 419,
    total: "8373",
  });
  assert.deepEqual(result.pagination, { page: 2, pages: 419, total: 8373 });
  assert.deepEqual(
    parseCmsPage({ code: 1, list: [], page: 1, pagecount: 0, total: 0 })
      .pagination,
    { page: 1, pages: 0, total: 0 },
  );
  assert.equal(parseCmsPage({ code: 1, list: [] }).pagination, null);
  assert.throws(
    () => parseCmsPage({ code: 1, list: [], page: "wrong", pagecount: 1 }),
    /分页/,
  );
  assert.throws(
    () => parseCmsPage({ code: 1, list: [], page: 0, pagecount: 1 }),
    /页码/,
  );
});

test("分类、页码和搜索只转换已确认的 CMS 参数，凭证参数保留", () => {
  const category = new URL(
    cmsUrl(
      "https://example.com/vod?token=abc&ids=old&wd=old",
      undefined,
      undefined,
      { page: 2, category: "13" },
    ),
  );
  assert.equal(category.searchParams.get("pg"), "2");
  assert.equal(category.searchParams.get("t"), "13");
  assert.equal(category.searchParams.has("wd"), false);
  assert.equal(category.searchParams.has("ids"), false);
  assert.equal(category.searchParams.get("token"), "abc");
  const all = new URL(cmsCategoriesUrl(category.href));
  assert.equal(all.searchParams.get("ac"), "list");
  assert.equal(all.searchParams.has("t"), false);
  assert.equal(all.searchParams.has("pg"), false);
});

test("饭太硬图片包装只解码数据，支持 JSON 注释且不放宽 CMS 响应或执行脚本", () => {
  const config =
    '{"sites":[// Android 爬虫\n{"key":"spider","name":"站点","type":3,"api":"csp_Demo"}]}';
  const wrapped =
    "\ufffd\ufffdJFIF\u0000**" + Buffer.from(config).toString("base64");
  const sites = parseSubscription(
    decodeRemoteJson(wrapped, { subscription: true }),
  );
  assert.equal(sites.length, 1);
  assert.equal(sites[0].supported, false);
  assert.throws(() => decodeRemoteJson(wrapped), /有效 JSON/);
  assert.throws(
    () => decodeRemoteJson("JFIF**not-valid!", { subscription: true }),
    /Base64/,
  );
  assert.throws(
    () => decodeRemoteJson("(()=>({sites:[]}))()", { subscription: true }),
    /有效 JSON/,
  );
  assert.throws(
    () => decodeRemoteJson('{"sites":[],}', { subscription: true }),
    /有效 JSON/,
  );
  assert.equal(
    decodeRemoteJson('{"url":"https://example.com/a//b"}', {
      subscription: true,
    }).url,
    "https://example.com/a//b",
  );
});

test("私有、回环、映射 IPv6、保留网络与非 HTTP 目标不能进入请求代理", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "198.18.0.1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of [
    "http://127.0.0.1",
    "http://2130706433",
    "http://[::ffff:7f00:1]",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    "https://example.com:8080",
  ]) {
    assert.throws(() => validateRemoteUrl(url));
  }
  await assert.rejects(readRemoteJson("http://169.254.169.254"), /公共 HTTP/);
});

test("标准 CMS 候选与 Spider/JAR 明确区分，重复 key 不静默覆盖", () => {
  const sites = [
    {
      key: "cms",
      name: "标准接口",
      type: 1,
      api: "https://example.com/api.php/provide/vod/",
    },
    { key: "spider", name: "爬虫", type: 3, api: "csp_demo" },
    {
      key: "jar",
      name: "JAR",
      type: 1,
      api: "https://example.com",
      jar: "test.jar",
    },
    { key: "private", name: "私网", type: 1, api: "http://127.0.0.1/api" },
  ];
  assert.deepEqual(
    parseSubscription({ sites }).map((s) => s.supported),
    [true, false, false, false],
  );
  assert.throws(
    () => parseSubscription({ sites: [sites[0], sites[0]] }),
    /重复/,
  );
  assert.throws(() => parseSubscription({ sites: "not an array" }), /sites/);
});

test("MoonTV api_site 按已核实的配置形状转换，不执行其他配置内容", () => {
  const result = parseSubscription({
    api_site: {
      movies: {
        name: "影片",
        api: "https://example.com/api.php/provide/vod",
        detail: "https://example.com",
      },
    },
  });
  assert.equal(result[0].key, "movies");
  assert.equal(result[0].supported, true);
  assert.equal(result[0].type, 1);
  assert.throws(
    () => parseSubscription({ api_site: { broken: { api: 4 } } }),
    /api_site/,
  );
});

test("仅详情暴露真实提供的导演、演员与地域字段，缺失信息不伪造", () => {
  const payload = {
    code: 1,
    list: [
      {
        vod_id: 1,
        vod_name: "影片",
        vod_actor: "演员甲,演员乙",
        vod_director: "导演甲",
        vod_area: "大陆",
        vod_lang: "国语",
      },
    ],
  };
  assert.equal(parseCms(payload, true)[0].actors, "演员甲,演员乙");
  assert.equal(parseCms(payload, true)[0].director, "导演甲");
  assert.equal(parseCms(payload)[0].actors, undefined);
  assert.equal(
    parseCms({ code: 1, list: [{ vod_id: 2, vod_name: "无信息" }] }, true)[0]
      .director,
    undefined,
  );
});

test("CMS 请求保留真实接口参数并覆盖 ac，不把多个影片作为一个详情请求", () => {
  const url = new URL(
    cmsUrl("https://example.com/vod?ac=list&token=abc", "123"),
  );
  assert.equal(url.searchParams.get("ac"), "detail");
  assert.equal(url.searchParams.get("token"), "abc");
  assert.equal(url.searchParams.get("ids"), "123");
});

test("依据 CMS 分隔符解析多线路，URL 内的 $ 保持原样，分享页不伪装成直链", () => {
  const [film] = parseCms(
    {
      code: 1,
      list: [
        {
          vod_id: 123,
          vod_name: "测试影片",
          vod_content: "<p>纯文本简介</p>",
          vod_play_from: "share$$$hls",
          vod_play_url:
            "第1集$https://example.com/share/abc#$$$第1集$https://example.com/1.m3u8?token=a$b#第2集$https://example.com/2.mp4#",
        },
      ],
    },
    true,
  );
  assert.equal(film.id, "123");
  assert.equal(film.description, "纯文本简介");
  assert.equal(film.lines[0].episodes[0].mime, null);
  assert.equal(
    film.lines[1].episodes[0].url,
    "https://example.com/1.m3u8?token=a$b",
  );
  assert.equal(film.lines[1].episodes[1].mime, "video/mp4");
});

test("错误的 CMS、线路数量与集数结构保留明确错误", () => {
  assert.throws(() => parseCms({ code: 0, list: [] }), /CMS JSON/);
  assert.throws(
    () => parseCms({ code: 1, list: [{ vod_name: "缺编号" }] }),
    /CMS JSON/,
  );
  assert.throws(
    () =>
      parseCms(
        {
          code: 1,
          list: [
            {
              vod_id: "1",
              vod_name: "影片",
              vod_play_from: "a$$$b",
              vod_play_url: "第1集$https://example.com/1.mp4",
            },
          ],
        },
        true,
      ),
    /数量不一致/,
  );
  assert.throws(
    () =>
      parseCms(
        {
          code: 1,
          list: [
            {
              vod_id: "1",
              vod_name: "影片",
              vod_play_from: "a",
              vod_play_url: "no-delimiter",
            },
          ],
        },
        true,
      ),
    /集数格式/,
  );
});
