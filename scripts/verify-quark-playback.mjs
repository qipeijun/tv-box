// 仅使用后端已保存的本人扫码授权，独立浏览器验证真实媒体，不输出账号凭据。
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TVBOX_PREVIEW || 'http://127.0.0.1:5196';
const output = process.env.TVBOX_EVIDENCE_DIR || '.scratch/source-compatibility-next/browser-quark-playback';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const result = { checkedAt: new Date().toISOString(), failures: [], retries: [], media: [] };
async function playing(page, minimum = 0.5) {
  const ready = () => page.waitForFunction((min) => {
    const v = document.querySelector('video');
    return [...document.querySelectorAll('.watch-loading button')].some((button) => button.textContent === '重试解析') || v && (v.error || (v.readyState >= 2 && v.videoWidth > 0 && !v.paused && v.currentTime >= min && v.getVideoPlaybackQuality().totalVideoFrames > 3));
  }, minimum, { timeout: 65_000 });
  await ready();
  const loading = page.locator('.watch-loading p');
  const message = await loading.count() ? await loading.first().textContent() : '';
  if (/无法连接源|超过 15 秒/.test(message ?? '')) {
    result.retries.push({ message, minimum });
    console.log('真实网络请求超时，点击页面重试解析一次。');
    await page.getByRole('button', { name: '重试解析', exact: true }).click();
    await ready();
  }
  const video = page.locator('video');
  assert.equal(await video.count(), 1, await page.locator('body').innerText());
  const state = await video.evaluate((v) => ({ time: v.currentTime, duration: v.duration, width: v.videoWidth, frames: v.getVideoPlaybackQuality().totalVideoFrames, error: v.error?.message ?? null }));
  assert.equal(state.error, null); return state;
}
async function newPage(width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    if (!localStorage.getItem('tvbox.library.v1')) localStorage.setItem('tvbox.library.v1', JSON.stringify({ version: 2, selection: { builtinId: 'cloud-public' }, customs: [], siteKeys: { 'builtin:cloud-public': 'kkpans-public' } }));
  });
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  page.on('pageerror', (e) => result.failures.push({ message: e.message }));
  page.on('response', async (r) => {
    const path = new URL(r.url()).pathname;
    if (r.status() >= 400 && path.startsWith('/api/')) result.failures.push({ path, status: r.status(), error: (await r.json().catch(() => ({}))).error });
    if (path.endsWith('/play') && r.ok()) result.media.push((await r.json()).url);
  });
  return page;
}
const page = await newPage();
try {
  await page.goto(`${base}/#search=&q=${encodeURIComponent('千金归来我们互为底牌')}`);
  await page.locator('main:not([hidden])').getByRole('button', { name: '查看千金归来我们互为底牌 (44集) 田欣雅&刘嘉蔓 | 短剧 [夸克网盘]', exact: true }).first().click({ timeout: 50_000 });
  await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('film') === '5716315');
  await page.locator('.film-actions button').first().click();
  console.log('已选择真实分享文件，开始验证后端转存与平台媒体。');
  result.first = await playing(page);
  console.log('第一集实际解码通过。');
  await page.getByRole('slider', { name: '播放进度' }).focus(); await page.keyboard.press('ArrowRight');
  result.seek = await playing(page, 5);
  await page.getByRole('button', { name: '选择集数和线路' }).click();
  await page.locator('.episode-tiles:visible button').nth(1).click();
  await page.waitForFunction(() => new URLSearchParams(location.hash.slice(1)).get('episode') === '0:1');
  result.next = await playing(page);
  console.log('切集与拖动通过。');
  await page.getByRole('slider', { name: '播放进度' }).focus();
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100); }
  await playing(page, 20);
  await page.getByRole('button', { name: '返回影片', exact: true }).click();
  result.saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tvbox.history.v1')).records?.[0]?.position);
  await page.locator('.film-actions button').first().click(); await playing(page, 18);
  await page.reload(); result.resumed = await playing(page, 18);
  console.log('刷新后续播通过，验证家庭第二路观看。');
  const second = await newPage(390);
  await second.goto(`${base}/#watch=5716315&episode=0:0`);
  result.concurrent = { first: await playing(page, 18), second: await playing(second) };
  await second.screenshot({ path: `${output}/mobile.png` });
  await second.close(); await page.screenshot({ path: `${output}/desktop.png` });
  result.passed = true;
} catch (error) {
  result.passed = false; result.error = error.message;
  result.pageText = (await page.locator('body').innerText()).slice(-2500);
  await page.screenshot({ path: `${output}/failed.png` }).catch(() => {}); process.exitCode = 1;
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); await browser.close();
}
