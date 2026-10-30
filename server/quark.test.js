import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { createQuarkAccountStore } from './cloud/account-store.js';
import { createQuarkAuth } from './cloud/quark-auth.js';
import { createQuarkPlayback } from './cloud/quark-playback.js';
import { quarkShare, quarkShareFiles } from './cloud/quark-share.js';
import { kkpansAdapter } from './adapters/kkpans.js';
import { parseCms } from './sources.js';
import { createApp } from './app.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tvbox-quark-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createQuarkAccountStore(dir);
  const jar = new CookieJar(); jar.setCookieSync('__pus=TEST_ACCOUNT; Domain=.quark.cn; Path=/; Secure; HttpOnly', 'https://pan.quark.cn/');
  return { dir, store, account: { revision: 'test-login', jar: jar.serializeSync(), updatedAt: '2026-10-30', folder: null, owned: [] } };
}
const video = (fid, name = fid) => ({ fid, file_name: name, file: true, dir: false, category: 1, share_fid_token: `TOKEN_${fid}` });
const share = { id: 'public-share', passcode: '' };
async function publicJson(address) {
  const url = new URL(address);
  if (url.pathname.endsWith('/token')) return { code: 0, data: { stoken: 'TEST_SHARE_TOKEN' } };
  return { code: 0, data: { list: [video('selected'), video('other')], metadata: { _total: 2 } } };
}

test('私有账号文件可重启恢复；退出后迟到的旧登录响应不能重新写入', async (t) => {
  const { dir, store, account } = await fixture(t);
  assert.equal(await store.get(), null);
  await store.set(account);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(join(dir, 'quark-account.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await createQuarkAccountStore(dir).get(), account);
  await store.clear();
  await assert.rejects(store.update(account.revision, (saved) => saved), /登录已变化/);
  await assert.rejects(readFile(join(dir, 'quark-account.json')), { code: 'ENOENT' });
  await assert.rejects(store.set(account, { guard: () => false }), /已取消/);
  assert.equal(await store.get(), null);
  await writeFile(join(dir, 'quark-account.json'), '{broken');
  const corrupt = createQuarkAccountStore(dir);
  await assert.rejects(corrupt.get(), /无法读取/);
  await corrupt.clear();
  assert.equal(await corrupt.get(), null);
});

test('扫码只返回本地二维码和状态；票据编码、Cookie更新、受保护验证和退出撤销贯通', async (t) => {
  const { dir, store } = await fixture(t); const revoked = [];
  let authorized = false, exchange = false;
  const auth = createQuarkAuth({ store, revoke: (prefix) => revoked.push(prefix), readJson: async (address) => {
    const url = new URL(address);
    assert.equal(url.searchParams.get('client_id'), '532');
    if (url.pathname.endsWith('/getTokenForQrcodeLogin')) return { status: 2000000, data: { members: { token: 'TEST_QR_TOKEN' } } };
    assert.equal(url.searchParams.get('token'), 'TEST_QR_TOKEN');
    return authorized ? { status: 2000000, data: { members: { service_ticket: 'ticket+/=' } } } : { status: 50004001 };
  }, readResponse: async (address, options) => {
    const url = new URL(address);
    if (url.pathname === '/account/info') {
      exchange = true; assert.equal(url.searchParams.get('st'), 'ticket+/=');
      assert.throws(() => options.headersFor(new URL('https://other.example.com/')), /异常/);
      options.onHeaders(url, { 'set-cookie': '__pus=TEST_ACCOUNT; Domain=.quark.cn; Secure; HttpOnly; Path=/' });
      return { text: '{}' };
    }
    assert.ok(exchange); assert.equal(url.pathname, '/1/clouddrive/member');
    assert.match(options.headersFor(url).cookie, /TEST_ACCOUNT/);
    options.onHeaders(url, { 'set-cookie': '__puus=TEST_REFRESHED; Domain=.quark.cn; Secure; HttpOnly; Path=/' });
    return { text: JSON.stringify({ code: 0, data: { member_type: 'NORMAL' } }) };
  } });
  t.after(() => auth.close());
  const qr = await auth.start();
  assert.deepEqual(Object.keys(qr).sort(), ['id', 'image', 'state']);
  assert.match(qr.image, /^data:image\/png;base64,/);
  assert.deepEqual(await auth.poll(qr.id), { state: 'waiting' });
  authorized = true;
  assert.deepEqual(await auth.poll(qr.id), { state: 'authorized' });
  const status = await auth.status(); assert.equal(status.state, 'logged_in');
  assert.equal(JSON.stringify(status).includes('TEST_'), false);
  const file = await readFile(join(dir, 'quark-account.json'), 'utf8');
  assert.match(file, /TEST_REFRESHED/); assert.equal(file.includes('ticket+/='), false); assert.equal(file.includes('TEST_QR_TOKEN'), false);
  await assert.rejects(auth.start(), /先退出/);
  await auth.logout(); assert.equal(revoked.length, 1); assert.match(revoked[0], /^quark:/);
  assert.equal((await auth.status()).state, 'logged_out');
  await assert.rejects(auth.poll(qr.id), /取消或更新/);
});

test('扫码取消发生在账号验证途中时，迟到授权不会落盘', async (t) => {
  const { store } = await fixture(t); let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const auth = createQuarkAuth({ store, readJson: async (url) => url.includes('getTokenForQrcodeLogin')
    ? { status: 2000000, data: { members: { token: 'TEST_QR' } } }
    : { status: 2000000, data: { members: { service_ticket: 'TEST_TICKET' } } },
    readResponse: async (address, options) => {
      if (address.includes('/account/info')) options.onHeaders(new URL(address), { 'set-cookie': '__pus=TEST; Domain=.quark.cn; Path=/' });
      else { entered(); await gate; }
      return { text: '{"code":0,"data":{}}' };
    } });
  t.after(() => auth.close());
  const qr = await auth.start(); const poll = auth.poll(qr.id);
  await waiting; auth.cancel(qr.id); release();
  await assert.rejects(poll, /取消/);
  assert.equal(await store.get(), null);
});

test('分享分页与文件名保持原顺序；不吞失效分享，不接受外站分享', async () => {
  assert.throws(() => quarkShare('https://elsewhere.example.com/s/id'), /不是已核实/);
  const files = await quarkShareFiles(share, async (address) => {
    const url = new URL(address);
    if (url.pathname.endsWith('/token')) return { code: 0, data: { stoken: 'TEST' } };
    if (url.searchParams.get('pdir_fid') === '0') return { code: 0, data: { list: [{ fid: 'dir', file_name: '目录', dir: true }], metadata: { _total: 1 } } };
    return { code: 0, data: { list: [video('e4', '04#$原名'), video('e1', '01')], metadata: { _total: 2 } } };
  });
  assert.deepEqual(files.map((item) => item.name), ['04#$原名', '01']);
  await assert.rejects(quarkShareFiles(share, async () => ({ code: 31002, message: '分享已失效' })), /分享已失效/);
});

test('KK独立来源按当前total分页，文件名恢复，文件引用随目录变化而变化', async () => {
  const io = { json: async (address) => {
    if (address.includes('pan.quark.cn')) return publicJson(address);
    if (new URL(address).pathname.endsWith('/5')) return { data: { id: 5, file_name: '分享样本', target_platform: 'quark', share_link: 'https://pan.quark.cn/s/public-share' } };
    return { data: [{ id: 5, file_name: '分享样本', target_platform: 'quark' }], total: 25, page: 1, limit: 24, category: { resource_count: 99 } };
  } };
  const page = await kkpansAdapter.page({}, { page: 1, category: 'top-250' }, io);
  assert.equal(page.pagecount, 2); assert.equal(page.total, 25);
  const film = parseCms(await kkpansAdapter.detail({}, '5', io), true, true)[0];
  const episodes = film.lines[0].episodes;
  assert.equal(kkpansAdapter.publicEpisode(episodes[0]).name, 'selected');
  assert.notEqual(kkpansAdapter.selectionRef(episodes[0].playbackId), kkpansAdapter.selectionRef(episodes[1].playbackId));
});

async function playbackFixture(t, responder, readJson = publicJson) {
  const { store, account } = await fixture(t); await store.set(account);
  const requests = [], revoked = []; let time = 1_000_000;
  let active = true;
  const auth = { store, isActive: () => active, logout: () => { active = false; return store.clear(); }, requestAccount: async (_account, path, options = {}) => {
    requests.push({ path, ...options });
    if (responder) { const result = await responder(path, options); if (result !== undefined) return result; }
    const route = new URL(path, 'https://drive.quark.cn').pathname;
    if (route.endsWith('/file')) return { fid: 'APP_FOLDER' };
    if (route.endsWith('/save')) return { task_id: 'TASK' };
    if (route.endsWith('/task')) return { status: 2, save_as: { save_as_top_fids: ['APP_FILE'] } };
    if (route.endsWith('/play')) return { video_list: [{ video_info: { url: 'https://media.example.com/movie.m3u8' } }] };
    if (route.endsWith('/delete')) return {};
    throw Error(`未模拟路径 ${route}`);
  } };
  const cloud = createQuarkPlayback({ auth, readJson, revoke: (id) => revoked.push(id), now: () => time, wait: async () => {} });
  return { cloud, store, requests, revoked, advance: (ms) => { time += ms; } };
}

test('仅转存所选文件，并发请求复用任务；活动文件不清理，过期仅删除任务确认的文件', async (t) => {
  const { cloud, store, requests, revoked, advance } = await playbackFixture(t);
  const selection = { share, fid: 'selected' };
  const [a, b] = await Promise.all([cloud.play(selection), cloud.play(selection)]);
  assert.equal(a.owner, b.owner);
  const saves = requests.filter((item) => item.path.includes('/save?'));
  assert.equal(saves.length, 1); assert.deepEqual(saves[0].body.fid_list, ['selected']);
  assert.equal(saves[0].body.to_pdir_fid, 'APP_FOLDER');
  assert.equal(saves[0].signal, undefined);
  assert.equal(requests.find((item) => item.path.includes('/play?')).body.fid, 'APP_FILE');
  assert.equal((await cloud.cleanup()).removed, 0);
  advance(60 * 60_000); a.onUse(); advance(2 * 60_000);
  assert.equal((await cloud.cleanup()).removed, 0);
  advance(62 * 60_000);
  assert.equal((await cloud.cleanup()).removed, 1);
  assert.deepEqual(requests.find((item) => item.path.includes('/delete?')).body.filelist, ['APP_FILE']);
  assert.deepEqual(revoked, [a.owner]); assert.equal((await store.get()).owned.length, 0);
});

test('页面中断后按持久化任务继续查询；提交结果不明时不重复写入', async (t) => {
  let polling = 0;
  const first = await playbackFixture(t, (path) => path.includes('/task?') && ++polling === 1 ? Promise.reject(Error('网络中断')) : undefined);
  await assert.rejects(first.cloud.play({ share, fid: 'selected' }), /网络中断/);
  assert.equal((await first.store.get()).owned[0].state, 'transferring');
  await first.cloud.play({ share, fid: 'selected' });
  assert.equal(first.requests.filter((item) => item.path.includes('/save?')).length, 1);
  const uncertain = await playbackFixture(t, (path) => path.includes('/save?') ? Promise.reject(Error('提交连接中断')) : undefined);
  await assert.rejects(uncertain.cloud.play({ share, fid: 'selected' }), /提交连接中断/);
  await assert.rejects(uncertain.cloud.play({ share, fid: 'selected' }), /不能重复提交/);
  assert.equal(uncertain.requests.filter((item) => item.path.includes('/save?')).length, 1);
  assert.equal((await uncertain.cloud.cleanup()).removed, 0);
});

test('退出清除凭据、提示尚存临时文件；API入口限制页面请求且不输出Cookie', async (t) => {
  const { cloud, store } = await playbackFixture(t);
  await cloud.play({ share, fid: 'selected' });
  assert.match((await cloud.logout()).warning, /不能继续清理/); assert.equal(await store.get(), null);
  const dir = await mkdtemp(join(tmpdir(), 'tvbox-cloud-api-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const app = createApp({ logger: false, dataDir: dir, allowedOrigins: ['http://localhost:5190'] }); t.after(() => app.close());
  assert.equal((await app.inject('/api/cloud/quark')).statusCode, 403);
  const response = await app.inject({ url: '/api/cloud/quark', headers: { host: 'localhost:5190', 'x-tvbox-client': 'web-v1' } });
  assert.equal(response.statusCode, 200); assert.equal(response.json().state, 'logged_out');
  assert.deepEqual(Object.keys(response.json()).sort(), ['pendingTransfers', 'platform', 'state', 'temporaryFiles', 'updatedAt']);
});

test('公开目录跨页完整读取，超过目录预算明确报错而非返回截断列表', async () => {
  const read = async (address) => {
    const url = new URL(address);
    if (url.pathname.endsWith('/token')) return { code: 0, data: { stoken: 'TEST' } };
    const page = Number(url.searchParams.get('_page'));
    return { code: 0, data: { list: page === 1 ? Array.from({ length: 100 }, (_, n) => video(String(n))) : [video('last')], metadata: { _total: 101 } } };
  };
  const files = await quarkShareFiles(share, read);
  assert.equal(files.length, 101); assert.equal(files.at(-1).fid, 'last');
  await assert.rejects(quarkShareFiles(share, async (address) => address.includes('/token?')
    ? { code: 0, data: { stoken: 'TEST' } }
    : { code: 0, data: { list: Array.from({ length: 100 }, (_, n) => ({ fid: `${new URL(address).searchParams.get('pdir_fid')}-${n}`, file_name: '目录', dir: true })), metadata: { _total: 100 } } }), /超过 1000|过多目录/);
});

test('按集API校验原文件引用，目录变动返回409；未登录不返回分享凭据', async (t) => {
  const { dir } = await fixture(t); let reversed = false;
  const app = createApp({ logger: false, dataDir: dir, allowedOrigins: ['http://localhost:5190'], readJson: async (address) => {
    if (address.includes('/api/resources/public/')) return { data: { id: 5, file_name: '样本', target_platform: 'quark', share_link: 'https://pan.quark.cn/s/public-share' } };
    const body = await publicJson(address);
    if (reversed && body.data.list) body.data.list.reverse();
    return body;
  } }); t.after(() => app.close());
  const headers = { host: 'localhost:5190', 'x-tvbox-client': 'web-v1' };
  const imported = await app.inject({ method: 'POST', url: '/api/subscriptions', headers, payload: { builtinId: 'cloud-public' } });
  const path = `/api/subscriptions/${imported.json().id}/sites/kkpans-public/videos/5`;
  const detail = await app.inject({ url: path, headers });
  const episode = detail.json().film.lines[0].episodes[0];
  assert.equal(episode.platform, 'quark'); assert.equal(episode.name, 'selected');
  assert.equal(detail.body.includes('TEST_SHARE_TOKEN'), false); assert.equal(detail.body.includes('TOKEN_selected'), false);
  let result = await app.inject({ method: 'POST', url: episode.url, headers, payload: { line: 0, episode: 0 } });
  assert.equal(result.statusCode, 401);
  reversed = true;
  result = await app.inject({ method: 'POST', url: episode.url, headers, payload: { line: 0, episode: 0 } });
  assert.equal(result.statusCode, 409); assert.match(result.body, /目录已变化/);
});

test('退出不等待在途解析才撤销播放，迟到地址也不能重新登记', async (t) => {
  let block = false, entered, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const waiting = new Promise((resolve) => { entered = resolve; });
  const f = await playbackFixture(t, async (path) => {
    if (block && path.includes('/play?')) { entered(); await gate; }
  });
  const media = await f.cloud.play({ share, fid: 'selected' }); assert.equal(media.isActive(), true);
  block = true;
  const inFlight = f.cloud.play({ share, fid: 'selected' }); await waiting;
  const logout = f.cloud.logout();
  await new Promise(setImmediate);
  assert.equal(media.isActive(), false); assert.ok(f.revoked.includes('quark:test-login:'));
  release();
  const late = await inFlight; await logout;
  assert.equal(late.isActive(), false); assert.equal(await f.store.get(), null);
});

test('后端保存登录后按集解析只输出同源令牌，退出后该令牌不可再访问', async (t) => {
  const { dir, store, account } = await fixture(t);
  account.folder = { fid: 'APP_FOLDER', name: '映场临时观看-test' };
  account.owned = [{ key: JSON.stringify([share.id, 'selected']), state: 'ready', fid: 'APP_FILE', createdAt: Date.now(), lastUsed: Date.now() }];
  await store.set(account);
  const app = createApp({ logger: false, dataDir: dir, allowedOrigins: ['http://localhost:5190'], readJson: async (address) => address.includes('/api/resources/public/')
    ? { data: { id: 5, file_name: '样本', target_platform: 'quark', share_link: 'https://pan.quark.cn/s/public-share' } }
    : publicJson(address), readResponse: async (address, options) => {
      assert.equal(new URL(address).pathname, '/1/clouddrive/file/v2/play');
      assert.match(options.headersFor(new URL(address)).cookie, /TEST_ACCOUNT/);
      assert.equal(JSON.parse(options.body).fid, 'APP_FILE');
      return { text: JSON.stringify({ code: 0, data: { video_list: [{ video_info: { url: 'https://media.example.com/protected.m3u8' } }] } }) };
    } }); t.after(() => app.close());
  const headers = { host: 'localhost:5190', 'x-tvbox-client': 'web-v1' };
  const imported = await app.inject({ method: 'POST', url: '/api/subscriptions', headers, payload: { builtinId: 'cloud-public' } });
  const detail = await app.inject({ url: `/api/subscriptions/${imported.json().id}/sites/kkpans-public/videos/5`, headers });
  const episode = detail.json().film.lines[0].episodes[0];
  const played = await app.inject({ method: 'POST', url: episode.url, headers, payload: { line: 0, episode: 0 } });
  assert.equal(played.statusCode, 200); assert.match(played.json().url, /^\/api\/media\/[a-f0-9-]+$/);
  assert.equal(played.body.includes('TEST_ACCOUNT'), false); assert.equal(played.body.includes('media.example.com'), false);
  const logout = await app.inject({ method: 'DELETE', url: '/api/cloud/quark', headers, payload: {} });
  assert.equal(logout.statusCode, 200);
  assert.equal((await app.inject({ url: played.json().url, headers })).statusCode, 410);
  assert.equal((await app.inject({ method: 'POST', url: episode.url, headers, payload: { line: 0, episode: 0 } })).statusCode, 401);
});

test('夸克受保护请求携带网页Origin，HTTP业务拒绝保留原因并区分提交结果不明', async (t) => {
  const { store, account } = await fixture(t); await store.set(account);
  const auth = createQuarkAuth({ store, readResponse: async (_url, options) => {
    assert.equal(options.headers.origin, 'https://pan.quark.cn');
    assert.equal(options.acceptHttpErrors, true);
    return { statusCode: 403, text: JSON.stringify({ code: 32003, message: '平台拒绝本次转存' }) };
  } }); t.after(() => auth.close());
  await assert.rejects(auth.requestAccount(account, '/1/clouddrive/share/sharepage/save', { method: 'POST', body: {} }), (error) => {
    assert.match(error.message, /HTTP 403/); assert.match(error.message, /平台拒绝本次转存/); assert.equal(error.rejected, true); return true;
  });
  const f = await playbackFixture(t, (path) => {
    if (path.includes('/save?')) { const error = Error('平台拒绝本次转存'); error.rejected = true; throw error; }
  });
  await assert.rejects(f.cloud.play({ share, fid: 'selected' }), /平台拒绝/);
  assert.equal((await f.store.get()).owned[0].state, 'failed');
  assert.equal((await f.cloud.status()).pendingTransfers, 0);
});

test('转存使用同一次分享会话的stoken与文件token，不再次获取令牌造成错配', async (t) => {
  let generation = 0;
  const f = await playbackFixture(t, (path, options) => {
    if (path.includes('/save?')) {
      assert.equal(options.body.stoken, 'SESSION_1');
      assert.deepEqual(options.body.fid_token_list, ['FILE_TOKEN_SESSION_1']);
    }
  }, async (address) => {
    const url = new URL(address);
    if (url.pathname.endsWith('/token')) return { code: 0, data: { stoken: `SESSION_${++generation}` } };
    assert.equal(url.searchParams.get('stoken'), 'SESSION_1');
    return { code: 0, data: { list: [{ ...video('selected'), share_fid_token: `FILE_TOKEN_SESSION_${generation}` }], metadata: { _total: 1 } } };
  });
  await f.cloud.play({ share, fid: 'selected' });
  assert.equal(generation, 1);
});
