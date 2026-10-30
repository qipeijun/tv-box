// 隔离浏览器回归；构造的影片与本机短片只验证交互，不代表真实来源可播放。
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TVBOX_PREVIEW || 'http://127.0.0.1:5192';
const media = await readFile(process.env.TVBOX_TEST_MEDIA || '/tmp/tvbox-design-qa.mp4');
const output = new URL('../docs/development/screenshots/apple-tv-upgrade/', import.meta.url).pathname;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const results = [];
const episodes = [0, 1, 2].map(i => ({ id: `0:${i}`, name: `第0${i+1}集`, url: `${base}/__upgrade.mp4`, mime: 'video/mp4', reason: '' }));
const film = { id: 'upgrade', name: '隔离验证：很长的影片名称与缺少海报时的页面重排', poster: null, remarks: '3 集', year: '2026', category: '剧集', description: '隔离构造内容，仅用于交互验证。', lines: [{name:'线路一', episodes}, {name:'线路二', episodes: episodes.map((e,i)=>({...e,id:`1:${i}`}))}] };
const sites = ['main','other'].map(key=>({key,name:key==='main'?'验证站点':'另一站点',supported:true,searchable:true,reason:''}));
const sub = { id:'upgrade-session', revision:'upgrade-v1', name:'验证片库', fetchedAt:'2026-10-30T00:00:00Z', sites, livePlaylists:[] };
let mode = 'ready';
async function setup(viewport, touch=false) {
 const c = await browser.newContext({viewport, hasTouch:touch, reducedMotion:'reduce'});
 await c.route('**/__upgrade.mp4', r=>{
  if(mode==='media-error') return r.fulfill({status:502,body:'隔离媒体失败'});
  const range=r.request().headers()['range'];
  const start=range?Number(range.match(/bytes=(\d+)/)?.[1]||0):0;
  return r.fulfill({status:range?206:200,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${media.length-1}/${media.length}`}:{})},body:media.subarray(start)});
 });
 await c.route('**/api/**', async r=>{
  const u = new URL(r.request().url()); const path=u.pathname;
  const json = (v,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(v)});
  if(path==='/api/subscriptions')return json(sub);
  if(path==='/api/builtins')return json({subscriptions:[{id:'curated',name:'验证片库',description:'隔离测试',checkedAt:'2026-10-30',source:'https://example.com'}]});
  if(path.includes('/metadata'))return json({candidates:[]});
  if(path.endsWith('/categories'))return json({categories:[{id:'1',name:'剧集'}]});
  if(path.endsWith('/videos/upgrade')) {if(mode==='detail-error')return json({error:'隔离详情失败'},502);return json({film});}
  if(path.includes('/videos')){
   if(mode==='fail' || (mode==='partial'&&path.includes('/other/')))return json({error:'隔离来源超时'},502);
   return json({films:mode==='empty'?[]:Array.from({length:20},(_,i)=>({...film,id:i===0?'upgrade':`item${i}`,name:i===0?film.name:`隔离影片 ${i}`})),pagination:{page:Number(u.searchParams.get('page')||1),pages:3,total:60}});
  }
  return json({error:'未定义的隔离接口'},404);
 });
 const p=await c.newPage();p.on('pageerror',e=>results.push({error:e.message}));
 return {c,p};
}
async function checkLayout(p,label){
 const metrics=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
 assert.ok(metrics.scroll<=metrics.width+1,`${label} 页面横向溢出 ${JSON.stringify(metrics)}`);
 results.push({check:label,...metrics});
}
try {
 for(const width of (process.env.TVBOX_CONTROLS_ONLY ? [1280] : [1280,390,320])){
  const {c,p}=await setup({width,height:width===1280?800:844},width<700);
  await p.goto(base);await p.locator('.feature-copy h1').waitFor();
  if(width===1280) {
   const shelf=p.locator('.media-shelf').first();const prev=shelf.getByRole('button',{name:/向前浏览/});const next=shelf.getByRole('button',{name:/向后浏览/});
   assert.ok(await prev.isDisabled());
   for(let i=0;i<8&&!await next.isDisabled();i++){await next.click();await p.waitForTimeout(50);}
   assert.ok(await next.isDisabled());assert.equal(await prev.isDisabled(),false);
   results.push({check:'shelf-boundary',passed:true});
  }
  for(const [label,hash] of [['home',''],['browse','#browse=&category=1&page=2'],['search','#search=&q=隔离'],['cross','#search=&scope=all&q=隔离'],['favorites','#history=&view=favorites'],['history','#history']]){
   await p.goto(base+'/'+hash);await p.waitForTimeout(300);await checkLayout(p,`${label}-${width}`);
  }
  // 从分类第二页进入，返回保持查询参数及海报焦点。
  await p.goto(base+'/#browse=&category=1&page=2');const card=p.locator('.catalog-page .poster-card').first();await card.click();await p.locator('.film-actions').waitFor();
  await checkLayout(p,`detail-${width}`);await p.screenshot({path:output+`fixture-detail-${width}.png`});
  await p.getByRole('button',{name:'收藏影片',exact:true}).click();
  await p.getByRole('button',{name:'返回上一页',exact:true}).click();await p.waitForFunction(()=>!location.hash.includes('film='));assert.ok(p.url().includes('page=2'));assert.ok(await card.evaluate(e=>e===document.activeElement));
  // 深链、选集、暂停／继续、拖动、键盘、全屏、退出和历史不堆叠。
  await p.goto(base+'/#watch=upgrade&episode=0%3A0');await p.waitForFunction(()=>document.querySelector('video')?.currentTime>0.2);
  const video=p.locator('video');await video.evaluate(v=>window.__upgradeVideo=v);
  await p.getByRole('button',{name:'暂停',exact:true}).click();assert.equal(await video.evaluate(v=>v.paused),true);
  await p.waitForFunction(()=>document.querySelector('video').duration>1);const before=await video.evaluate(v=>v.currentTime);await p.waitForFunction(()=>Number(document.querySelector('[aria-label=播放进度]').max)>1);await p.getByRole('button',{name:'快进10秒',exact:true}).click();await p.waitForFunction(t=>document.querySelector('video').currentTime>=t,Math.min(before+9,await video.evaluate(v=>v.duration)-.2));
  await p.getByRole('button',{name:'后退10秒',exact:true}).click();
  const slider=p.getByRole('slider',{name:'播放进度'});await slider.focus();await p.keyboard.press('ArrowRight');
  const box=await slider.boundingBox();await p.mouse.move(box.x+box.width*.3,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width*.5,box.y+box.height/2);await p.mouse.up();
  await p.getByRole('button',{name:'播放',exact:true}).last().click();
  if(width===1280) {
   await p.getByRole('button',{name:'暂停',exact:true}).hover();
   await p.waitForTimeout(3300);
   assert.equal(await p.locator('.cinema-controls').getAttribute('data-visible'),'true');
   const sizes=await p.locator('.cinema-controls button').evaluateAll(buttons=>buttons.map(b=>{const r=b.getBoundingClientRect();return {name:b.getAttribute('aria-label'),width:r.width,height:r.height}}).filter(r=>r.width>0));
   assert.ok(sizes.every(r=>r.width>=44&&r.height>=44),JSON.stringify(sizes));
   results.push({check:'controls-hover-and-targets',sizes,passed:true});
  }
  await p.getByRole('button',{name:'选择集数和线路'}).click();
  if(width===1280){await p.getByRole('button',{name:'关闭选集',exact:true}).click();}
  assert.ok(await video.evaluate(v=>v===window.__upgradeVideo),'选集不能重建播放器');
  await p.locator('.cinema-player').focus();await p.keyboard.press('k');
  if(!await video.evaluate(v=>v.paused)) await p.keyboard.press('k');
  await p.getByRole('button',{name:'全屏',exact:true}).click();assert.ok(await p.evaluate(()=>!!document.fullscreenElement));
  await p.getByRole('button',{name:'退出全屏',exact:true}).click();assert.equal(await p.evaluate(()=>!!document.fullscreenElement),false);
  await checkLayout(p,`player-${width}`);
  await p.getByRole('button',{name:'返回影片',exact:true}).click();await p.waitForFunction(()=>location.hash.includes('film=upgrade'));
  await p.getByRole('button',{name:'返回上一页',exact:true}).click();await p.waitForFunction(()=>!location.hash);
  // 每个实际入口都经过详情与播放再返回，浏览器后退与页面返回分别检查。
  for (const hash of (process.env.TVBOX_CONTROLS_ONLY ? [] : ['', '#search=&q=隔离', '#search=&scope=all&q=隔离', '#history=&view=favorites', '#history'])) {
   await p.goto(base+'/'+hash);
   const opener = hash.includes('favorites') ? p.locator('.favorite-open:visible').first() : hash==='#history' ? p.locator('.history-resume:visible').first() : hash ? p.locator('.catalog-page .poster-card').first() : p.locator('.media-shelf .poster-card').first();
   console.log('验证入口',width,hash||'home');
   await opener.click();await p.waitForFunction(()=>new URLSearchParams(location.hash.slice(1)).has('watch')||new URLSearchParams(location.hash.slice(1)).has('film'));
   if (!p.url().includes('watch=')) {
    await p.locator('.film-actions [data-variant="default"]').click();
    if (!p.url().includes('watch=')) await p.locator('.detail-episodes .episode-tile').first().click();
   }
   await p.waitForFunction(()=>document.querySelector('video')?.currentTime>0.1);
   const entry = p.url();
   const scope = width===1280 ? '.watch-episodes-dialog' : '.watch-inline-episodes';
   await p.locator('.cinema-player').focus();await p.getByRole('button',{name:'选择集数和线路'}).click();
   if(new URLSearchParams(new URL(p.url()).hash.slice(1)).get('episode')?.startsWith('1:')) {
    await p.locator(scope).getByTitle('线路一',{exact:true}).click();
    await p.waitForFunction(()=>location.hash.includes('episode=0%3A'));
    await p.getByRole('button',{name:'选择集数和线路'}).click();
   }
   await p.locator(scope).getByRole('button',{name:/^第02集/}).click();
   await p.waitForFunction(()=>location.hash.includes('episode=0%3A1'));
   await p.waitForFunction(()=>document.querySelector('video')?.currentTime>0.1);
   await p.locator('.cinema-player').focus();await p.getByRole('button',{name:'选择集数和线路'}).click();
   await p.locator(scope).getByTitle('线路二',{exact:true}).click();
   await p.waitForFunction(()=>location.hash.includes('episode=1%3A1'));
   await p.goBack();await p.waitForFunction(()=>location.hash.includes('film=upgrade'));
   await p.getByRole('button',{name:'返回上一页',exact:true}).click();
   await p.waitForFunction(()=>!new URLSearchParams(location.hash.slice(1)).has('film'));
   assert.equal(new URL(p.url()).hash, new URL(base+'/'+hash).hash);
   results.push({check:`return-${hash||'home'}-${width}`,passed:true,entry});
  }
  await c.close();
 }
 const {c,p}=await setup({width:1280,height:800});
 for(const state of ['partial','empty','fail']){
  mode=state;await p.goto(base+'/#search=&scope=all&q='+state);await p.waitForTimeout(500);
  if(state==='partial') assert.ok(await p.locator('.cross-search-group').count()>0);
  if(state==='empty')await p.getByRole('heading',{name:'没有找到这部影片'}).waitFor();
  if(state==='fail')await p.getByText('所有来源均读取失败',{exact:false}).waitFor();
  await p.locator('.cross-search-status summary').click();await p.screenshot({path:output+`fixture-cross-${state}.png`});
  results.push({check:`cross-${state}`,passed:true});
 }
 mode='ready';await p.getByRole('textbox',{name:'跨站搜索片名'}).fill('换词');await p.locator('.catalog-search button').click();await p.locator('.cross-search-group').first().waitFor();assert.ok(p.url().includes(encodeURIComponent('换词')));
 assert.equal(await p.locator('.catalog-page').evaluate(e=>getComputedStyle(e).animationName),'none');
 results.push({check:'changed-query-and-reduced-motion',passed:true});
 mode='media-error';await p.goto(base+'/#watch=upgrade&episode=0%3A0');await p.locator('.cinema-error').waitFor();mode='ready';await p.getByRole('button',{name:'重试',exact:true}).click();await p.waitForFunction(()=>document.querySelector('video')?.currentTime>0.1);results.push({check:'media-retry',passed:true});
 mode='detail-error';await p.goto(base+'/#watch=upgrade&episode=0%3A0');await p.reload();await p.getByRole('heading',{name:'暂时无法播放'}).waitFor();await p.getByRole('button',{name:'返回影片',exact:true}).click();
 await c.close();
 assert.equal(results.filter(r=>r.error).length,0,JSON.stringify(results));
 await writeFile(output+(process.env.TVBOX_CONTROLS_ONLY?'controls-results.json':'interaction-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
