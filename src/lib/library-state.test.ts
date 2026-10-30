import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeLibraryPreferences,
  emptyPreferences,
  libraryKey,
  saveCustomLibrary,
  removeCustomLibrary,
} from "./library-state.ts";

test("旧 URL 列表迁移为具名订阅，保留所选片库与站点；空配置使用内置精选", () => {
  const legacy = decodeLibraryPreferences(
    JSON.stringify({
      selection: { url: "https://example.com/config.json" },
      customs: ["https://example.com/config.json"],
      siteKey: "cms",
    }),
  );
  assert.equal(legacy.version, 2);
  assert.equal(legacy.customs[0].name, "自定义片库 1");
  assert.equal(legacy.siteKeys[libraryKey(legacy.selection)], "cms");
  assert.deepEqual(decodeLibraryPreferences(null).selection, {
    builtinId: "curated",
  });
  const rootAddress = decodeLibraryPreferences(
    JSON.stringify({
      selection: { url: "https://example.com" },
      customs: ["https://example.com"],
      siteKey: "root",
    }),
  );
  assert.equal(rootAddress.siteKeys[libraryKey(rootAddress.selection)], "root");
  assert.deepEqual(
    decodeLibraryPreferences(JSON.stringify({ ...legacy, customs: [] }))
      .selection,
    { builtinId: "curated" },
  );
});

test("损坏、未知版本和非法订阅配置不当成正常的空列表", () => {
  for (const raw of [
    "broken",
    JSON.stringify({
      version: 3,
      selection: { builtinId: "curated" },
      customs: [],
    }),
    JSON.stringify({ selection: { url: "javascript:alert(1)" }, customs: [] }),
  ])
    assert.throws(() => decodeLibraryPreferences(raw));
  assert.throws(
    () =>
      saveCustomLibrary(emptyPreferences(), {
        id: "x",
        name: "",
        url: "https://example.com",
      }),
    /名称/,
  );
  assert.throws(
    () =>
      saveCustomLibrary(emptyPreferences(), {
        id: "x",
        name: "片库",
        url: "https://user:secret@example.com",
      }),
    /账号/,
  );
});

test("添加与具名配置可持久化恢复；规范化重复地址和超过数量限制均明确拒绝", () => {
  let value = saveCustomLibrary(emptyPreferences(), {
    id: "one",
    name: " 我的片库 ",
    url: "https://example.com",
  });
  assert.equal(value.customs[0].name, "我的片库");
  assert.equal(value.customs[0].url, "https://example.com/");
  assert.deepEqual(decodeLibraryPreferences(JSON.stringify(value)), value);
  assert.throws(
    () =>
      saveCustomLibrary(value, {
        id: "two",
        name: "重复",
        url: "https://example.com/",
      }),
    /添加过/,
  );
  for (let i = 1; i < 20; i++)
    value = saveCustomLibrary(value, {
      id: String(i),
      name: `片库 ${i}`,
      url: `https://example.com/${i}`,
    });
  assert.throws(
    () =>
      saveCustomLibrary(value, {
        id: "21",
        name: "超过上限",
        url: "https://example.com/21",
      }),
    /20/,
  );
});

test("编辑非当前订阅保持当前选择；更换当前地址后清除旧站点身份，不改原对象", () => {
  let value = saveCustomLibrary(emptyPreferences(), {
    id: "a",
    name: "甲",
    url: "https://example.com/a",
  });
  value = saveCustomLibrary(value, {
    id: "b",
    name: "乙",
    url: "https://example.com/b",
  });
  value = {
    ...value,
    selection: { url: "https://example.com/a" },
    siteKeys: {
      "url:https://example.com/a": "old",
      "url:https://example.com/b": "other",
    },
  };
  const inactive = saveCustomLibrary(value, {
    id: "b",
    name: "乙新名称",
    url: "https://example.com/b-new",
  });
  assert.deepEqual(inactive.selection, value.selection);
  assert.equal(inactive.siteKeys["url:https://example.com/a"], "old");
  const active = saveCustomLibrary(value, {
    id: "a",
    name: "甲新名称",
    url: "https://example.com/a-new",
  });
  assert.deepEqual(active.selection, { url: "https://example.com/a-new" });
  assert.equal(active.siteKeys["url:https://example.com/a"], undefined);
  assert.equal(value.siteKeys["url:https://example.com/a"], "old");
});

test("改名保留站点选择；删除非当前订阅不换片库，删除当前订阅回到精选并清理身份", () => {
  const initial = saveCustomLibrary(emptyPreferences(), {
    id: "a",
    name: "甲",
    url: "https://example.com/a",
  });
  const value = {
    ...initial,
    selection: { url: "https://example.com/a" },
    siteKeys: { "url:https://example.com/a": "cms" },
  };
  assert.equal(
    saveCustomLibrary(value, { ...initial.customs[0], name: "新名字" })
      .siteKeys["url:https://example.com/a"],
    "cms",
  );
  const removedInactive = removeCustomLibrary(initial, "a");
  assert.deepEqual(removedInactive.selection, initial.selection);
  const removed = removeCustomLibrary(value, "a");
  assert.equal(removed.customs.length, 0);
  assert.deepEqual(removed.selection, { builtinId: "curated" });
  assert.deepEqual(removed.siteKeys, {});
});
