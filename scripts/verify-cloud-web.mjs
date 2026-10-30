// 真实公共目录与本人扫码验收；独立浏览器，不读取既有登录资料。
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TVBOX_PREVIEW || 'http://127.0.0.1:5196';
const output = process.env.TVBOX_EVIDENCE_DIR || '.scratch/source-compatibility-next/browser-cloud';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: Number(process.env.TVBOX_TEST_WIDTH || 1280), height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const result = { checkedAt: new Date().toISOString(), failures: [] };
page.on('pageerror', (error) => result.failures.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem('tvbox.library.v1', JSON.stringify({ version: 2, selection: { builtinId: 'cloud-public' }, customs: [], siteKeys: { 'builtin:cloud-public': 'kkpans-public' } }));
});
try {
  await page.goto(`${base}/#search=&q=${encodeURIComponent('幻视任务')}`);
  const target = page.locator('main:not([hidden])').getByRole('button', { name: /^查看幻视任务/ }).first();
  await target.waitFor({ timeout: 50_000 });
  result.search = true;
  await target.click();
  await page.locator('.film-actions button').first().waitFor({ timeout: 50_000 });
  result.detail = await page.locator('main:not([hidden])').innerText();
  await page.locator('.film-actions button').first().click();
  await page.getByText('请先登录夸克网盘后播放。', { exact: true }).waitFor({ timeout: 50_000 });
  result.loginRequired = true;
  await page.getByRole('button', { name: '网盘登录', exact: true }).click();
  await page.getByText('尚未登录夸克', { exact: true }).waitFor();
  await page.getByRole('button', { name: '生成登录二维码' }).click();
  const image = page.getByRole('img', { name: '夸克本人登录二维码' });
  await image.waitFor({ timeout: 30_000 });
  assert.match(await image.getAttribute('src'), /^data:image\/png;base64,/);
  await page.getByRole('dialog').screenshot({ path: `${output}/quark-login.png` });
  await writeFile(`${output}/qr.png`, Buffer.from((await image.getAttribute('src')).split(',')[1], 'base64'), { mode: 0o600 });
  result.qrCreated = true;
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log('真实目录、未登录提示、二维码生成通过；等待本人扫码。二维码已保存到 ' + output + '/qr.png');
  await page.getByText('已保存夸克登录', { exact: true }).waitFor({ timeout: 600_000 });
  result.loginConfirmed = true;
  await page.getByRole('dialog').screenshot({ path: `${output}/quark-authorized.png` });
  await page.getByRole('button', { name: '返回观看', exact: true }).click();
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && (v.error || (v.readyState >= 2 && v.videoWidth > 0 && !v.paused && v.currentTime > 0.5));
  }, undefined, { timeout: 90_000 });
  result.playback = await page.locator('video').evaluate((v) => ({ time: v.currentTime, duration: v.duration, width: v.videoWidth, error: v.error?.message ?? null, frames: v.getVideoPlaybackQuality().totalVideoFrames }));
  assert.equal(result.playback.error, null);
  result.passed = true;
} catch (error) {
  result.error = error.message;
  result.pageText = (await page.locator('body').innerText()).slice(-2000);
  await page.screenshot({ path: `${output}/failed.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
}
