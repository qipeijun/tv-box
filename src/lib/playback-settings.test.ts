import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePlaybackSettings } from "./playback-settings.ts";
test("自动连播默认开启，明确关闭后可按版本恢复，不做真假值转换", () => {
  assert.deepEqual(decodePlaybackSettings(null), {
    version: 1,
    autoNext: true,
  });
  assert.deepEqual(decodePlaybackSettings('{"version":1,"autoNext":false}'), {
    version: 1,
    autoNext: false,
  });
});
test("损坏和未知版本的自动连播设置明确拒绝，读取过程不重建原数据", () => {
  for (const value of [
    "{",
    "null",
    '{"version":2,"autoNext":true}',
    '{"version":1,"autoNext":"false"}',
    '{"version":1}',
  ])
    assert.throws(() => decodePlaybackSettings(value));
});
