import { test } from "node:test";
import assert from "node:assert/strict";
import { fitsArtwork, fitsBackdrop } from "./artwork-quality.ts";

test("同一横图在普通屏可铺满，在高密度屏或更宽窗口回退", () => {
  const image = { width: 1920, height: 1080 };
  assert.equal(fitsBackdrop(image, { width: 1440, height: 630 }, 1), true);
  assert.equal(fitsBackdrop(image, { width: 1440, height: 630 }, 2), false);
  assert.equal(fitsBackdrop(image, { width: 2560, height: 700 }, 1), false);
});
test("横图高度不足、竖图、未知显示尺寸均不进入通栏", () => {
  assert.equal(fitsBackdrop({ width: 4000, height: 300 }, { width: 1440, height: 630 }, 1), false);
  assert.equal(fitsBackdrop({ width: 2000, height: 3000 }, { width: 1440, height: 630 }, 1), false);
  assert.equal(fitsBackdrop({ width: 1920, height: 1080 }, { width: 0, height: 0 }, 1), false);
});
test("手机按自身尺寸与密度选择海报展示方式", () => {
  assert.equal(fitsArtwork({ width: 1370, height: 1920 }, { width: 390, height: 480 }, 3), true);
  assert.equal(fitsArtwork({ width: 400, height: 600 }, { width: 390, height: 480 }, 3), false);
});
