// 真实来源验收。原服务缓存未刷新时，只在隔离浏览器中映射前端资源，API 与媒体保持真实请求。
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const origin=process.env.TVBOX_ORIGIN||'http://127.0.0.1:5190';
const preview=process.env.TVBOX_PREVIEW||'http://127.0.0.1:5192';
const output=new URL('../docs/development/screenshots/apple-tv-upgrade/',import.meta.url).pathname;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1280,height:800},hasTouch:true});
await context.route(origin+'/**',async route=>{
 if(new URL(route.request().url()).pathname.startsWith('/api/'))return route.continue();
 return route.fulfill({response:await route.fetch({url:route.request().url().replace(origin,preview)})});
});
const page=await context.newPage();const results=[];
page.on('pageerror',e=>results.push({error:e.message}));
async function shot(label){
 const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
 assert.ok(layout.scroll<=layout.width+1,`${label} overflow`);
 await page.screenshot({path:output+`after-${label}.png`});results.push({check:label,...layout});
}
try{
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:width===1280?800:844});
  for(const [label,hash] of [['home',''],['search','#search=&scope=all&q=流浪地球'],['browse','#browse='],['detail','#film=99329'],['player','#watch=99329&episode=1%3A0']]){
   await page.goto(origin+'/'+hash);
   if(label==='home')await page.locator('.feature-copy h1').waitFor();
   if(label==='search')await page.locator('.cross-search-group').first().waitFor({timeout:45000});
   if(label==='browse')await page.locator('.catalog-page .poster-card').first().waitFor({timeout:45000});
   if(label==='detail')await page.locator('.detail-episodes .episode-picker').waitFor({timeout:45000});
   if(label==='player'){
    await page.waitForFunction(()=>document.querySelector('video')?.currentTime>1,{},{timeout:45000});
    const before=await page.locator('video').evaluate(v=>v.currentTime);
    await page.waitForFunction(t=>document.querySelector('video')?.currentTime>t+0.5,before,{timeout:20000});
    const after=await page.locator('video').evaluate(v=>v.currentTime);
    assert.ok(after>before);results.push({check:`real-playing-${width}`,before,after,film:'99329',episode:'1:0'});
    if(width===390){
     await page.mouse.move(0,840);await page.waitForFunction(()=>document.querySelector('.cinema-controls').dataset.visible==='false');
     await page.evaluate(()=>{window.__events=[];for(const type of ['pointerdown','pointerup','click'])document.querySelector('.cinema-tap-area').addEventListener(type,()=>window.__events.push({type,visible:document.querySelector('.cinema-controls').dataset.visible}));});
     await page.locator('.cinema-tap-area').tap();
     assert.equal(await page.locator('.cinema-controls').getAttribute('data-visible'),'true');
     results.push({check:'hidden-controls-tap',events:await page.evaluate(()=>window.__events),passed:true});
    }
   }
   await shot(`${label}-${width}`);
  }
 }
 await page.setViewportSize({width:844,height:390});await shot('player-landscape');
 await page.locator('.cinema-player').focus();await page.keyboard.press('k');
 await page.getByRole('button',{name:'全屏',exact:true}).click();assert.ok(await page.evaluate(()=>!!document.fullscreenElement));await shot('player-fullscreen');
 await page.getByRole('button',{name:'退出全屏',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 for(const [label,hash] of [['library','#library'],['live','#live']]){
  await page.goto(origin+'/'+hash);await page.waitForTimeout(3000);await shot(label);
  results.push({check:`${label}-text`,text:(await page.locator('body').innerText()).slice(0,500)});
 }
 assert.equal(results.filter(r=>r.error).length,0,JSON.stringify(results));
 await writeFile(output+'real-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close()}
