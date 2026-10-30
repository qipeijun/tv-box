// 仅连接独立验收实例，使用真实来源接口和媒体；不接管现有浏览器或登录状态。
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.TVBOX_PREVIEW || "http://127.0.0.1:5194";
const output = process.env.TVBOX_EVIDENCE_DIR || ".scratch/backend-compatibility/browser-evidence";
const width = Number(process.env.TVBOX_TEST_WIDTH || 1280);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const results = [];
const samples = [
  { site: "光影", film: "148627", name: "伟大的长征", category: "13", line: 0 },
  { site: "奶酪", film: "35200", name: "庆余年 第一季", search: "庆余年", line: 0 },
  { site: "热播", film: "54444", name: "庆余年 第二季", search: "庆余年", line: Number(process.env.TVBOX_REBO_LINE || 0) },
  { site: "糯米", film: "96508", name: "小城良方", category: "2", line: 0 },
  { site: "YGP", film: "15789", name: "疾速追杀", category: "nowplaying", line: 0 },
].filter((item) => !process.env.TVBOX_TEST_SITE || item.site === process.env.TVBOX_TEST_SITE);
async function playing(page, minimum = 0.5) {
  await page.waitForFunction((min) => {
    const v = document.querySelector("video");
    return v && (v.error || (v.readyState >= 2 && v.videoWidth > 0 && !v.paused && v.currentTime >= min && v.getVideoPlaybackQuality().totalVideoFrames > 3));
  }, minimum, { timeout: 60_000 });
  assert.equal(await page.locator("video").evaluate((v) => v.error?.message ?? null), null, "媒体加载或解码失败");
  return page.locator("video").evaluate((v) => ({ time: v.currentTime, duration: v.duration, width: v.videoWidth, frames: v.getVideoPlaybackQuality().totalVideoFrames }));
}
try {
  for (const sample of samples) {
    const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 800 }, hasTouch: width < 700, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const result = { site: sample.site, film: sample.film, line: sample.line, width, failures: [] };
    page.on("response", async (r) => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith("/api/")) result.failures.push({ status: r.status(), path: new URL(r.url()).pathname, error: (await r.json().catch(() => ({}))).error }); });
    page.on("pageerror", (e) => result.failures.push({ error: e.message }));
    await page.addInitScript((site) => {
      if (!localStorage.getItem("tvbox.library.v1")) localStorage.setItem("tvbox.library.v1", JSON.stringify({ version: 2, selection: { builtinId: "fantaiying" }, customs: [], siteKeys: { "builtin:fantaiying": site } }));
    }, sample.site);
    try {
      console.log(`${sample.site}：读取真实影片列表`);
      const location = sample.search ? `#search=&q=${encodeURIComponent(sample.search)}` : `#browse=&category=${sample.category}`;
      await page.goto(`${base}/${location}`);
      // 分类首页实时变化；选定样本仍从页面的真实影片卡片进入，未注入任何接口响应。
      const target = page.locator("main:not([hidden]) .poster-card");
      await target.first().waitFor({ timeout: 40_000 });
      const chosen = page.locator("main:not([hidden])").getByRole("button", { name: `查看${sample.name}`, exact: true }).last();
      await chosen.click();
      console.log(`${sample.site}：进入影片详情`);
      await page.waitForFunction((id) => new URLSearchParams(location.hash.slice(1)).get("film") === id, sample.film);
      await page.locator(".film-actions button").first().waitFor();
      await page.locator(".film-actions button").first().click();
      if (sample.line !== 0) {
        await page.getByRole("button", { name: "选择集数和线路" }).click();
        await page.locator(".episode-line-tabs:visible button").nth(sample.line).click();
        await page.locator(".episode-tiles:visible button").first().click();
      }
      result.playback = await playing(page);
      console.log(`${sample.site}：真实解码通过，验证拖动和切集`);
      const slider = page.getByRole("slider", { name: "播放进度" });
      await slider.focus();
      await page.keyboard.press("ArrowRight");
      await playing(page, 5);
      result.seek = await page.locator("video").evaluate((v) => v.currentTime);
      await page.getByRole("button", { name: "选择集数和线路" }).click();
      await page.locator(".episode-tiles:visible button").nth(1).click();
      await page.waitForFunction((expected) => new URLSearchParams(location.hash.slice(1)).get("episode") === expected, `${sample.line}:1`);
      result.nextEpisode = await playing(page);
      console.log(`${sample.site}：切集通过，验证续播`);
      await page.getByRole("slider", { name: "播放进度" }).focus();
      for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(100); }
      await playing(page, 20);
      // 返回会强制保存当前位置，再从同一真实集深链刷新，检查新媒体令牌下的续播。
      await page.getByRole("button", { name: "返回影片", exact: true }).click();
      result.saved = await page.evaluate(() => {
        const data = JSON.parse(localStorage.getItem("tvbox.history.v1"));
        return data.records?.[0] ?? data;
      });
      await page.locator(".film-actions button").first().click();
      await playing(page, 18);
      await page.reload();
      console.log(`${sample.site}：已刷新，检查恢复位置`);
      result.resumed = await playing(page, 18);
      assert.ok(result.resumed.time >= 18, "刷新后未恢复进度");
      await page.screenshot({ path: `${output}/${sample.site}.png` });
      result.passed = true;
    } catch (error) {
      result.passed = false;
      result.error = error.message;
      result.pageText = (await page.locator("body").innerText()).slice(-1400);
      await page.screenshot({ path: `${output}/${sample.site}-failed.png` }).catch(() => {});
    } finally {
      results.push(result);
      console.log(JSON.stringify(result));
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      await context.close();
    }
  }
} finally { await browser.close(); }
if (results.some((item) => !item.passed)) process.exitCode = 1;
