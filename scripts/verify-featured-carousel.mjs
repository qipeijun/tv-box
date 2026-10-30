// 轮播交互在独立上下文中使用无海报的构造数据；真实图片另行截图验收。
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TVBOX_PREVIEW||'http://127.0.0.1:5193';
const output=new URL('../docs/development/screenshots/featured-carousel/',import.meta.url).pathname;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
const c=await browser.newContext({viewport:{width:1280,height:800}});
const films=Array.from({length:5},(_,i)=>({id:String(i),name:`轮播验证影片${i}`,poster:null,description:'隔离验证',year:'2026',category:'影片',remarks:''}));
const sub={id:'carousel',revision:'carousel-v1',name:'验证片库',fetchedAt:'2026-10-30',sites:[{key:'main',name:'验证站点',supported:true,searchable:true,reason:''}],livePlaylists:[]};
await c.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;const json=v=>r.fulfill({contentType:'application/json',body:JSON.stringify(v)});if(path==='/api/builtins')return json({subscriptions:[{id:'curated',name:'验证片库'}]});if(path==='/api/subscriptions')return json(sub);if(path.endsWith('/categories'))return json({categories:[]});if(path.includes('/videos'))return json({films,pagination:{page:1,pages:1,total:5}});return json({candidates:[]})});
const p=await c.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));const checks=[];
const title=()=>p.locator('.feature-copy h1').innerText();
async function check(name,action){await action();checks.push(name);console.log(name)}
try{
 await p.clock.install();await p.goto(base);await p.locator('.feature-copy h1').waitFor();
 await p.evaluate(()=>window.__posters=[...document.querySelectorAll('.feature-posters button')]);
 const area=p.locator('.feature-posters');const box=await area.boundingBox();
 await check('鼠标拖动跟随、提交一次、不误进详情',async()=>{
  await p.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await p.mouse.down();await p.mouse.move(box.x+box.width*.5-65,box.y+box.height*.5,{steps:5});
  assert.ok((await area.locator('[data-current=true]').getAttribute('style')).includes('translateX(-'));
  assert.equal(await title(),'轮播验证影片0');await p.mouse.up();assert.equal(await title(),'轮播验证影片1');assert.equal(new URL(p.url()).hash,'');
 });
 await check('滚轮与触摸板惯性一次切换、反向可立即响应',async()=>{
  await p.mouse.wheel(90,0);await p.waitForFunction(()=>document.querySelector('.feature-copy h1').textContent==='轮播验证影片2');await p.mouse.wheel(70,0);assert.equal(await title(),'轮播验证影片2');await p.mouse.wheel(-90,0);await p.waitForFunction(()=>document.querySelector('.feature-copy h1').textContent==='轮播验证影片1');
 });
 await check('卡片节点保留、标题与中央海报对应',async()=>{assert.ok(await p.evaluate(()=>window.__posters.every((node,i)=>node===document.querySelectorAll('.feature-posters button')[i])));assert.equal(await area.locator('[data-current=true]').getAttribute('aria-label'),'查看'+await title());});
 await check('悬停与聚焦暂停自动轮播',async()=>{
  const t=await title();await p.clock.fastForward(6500);assert.equal(await title(),t);await p.locator('.feature-carousel').focus();await p.mouse.move(0,0);await p.clock.fastForward(6500);assert.equal(await title(),t);
 });
 await check('自动轮播与手动暂停',async()=>{
  await p.locator('.media-brand').focus();await p.clock.fastForward(6500);assert.notEqual(await title(),'轮播验证影片1');
  await p.getByRole('button',{name:'暂停自动轮播',exact:true}).click();await p.locator('.media-brand').focus();await p.mouse.move(0,0);const t=await title();await p.clock.fastForward(13000);assert.equal(await title(),t);
 });
 await check('键盘即时切换、手动重启、隐藏页面不轮播',async()=>{
  await p.locator('.feature-carousel').focus();const t=await title();await p.keyboard.press('ArrowRight');assert.notEqual(await title(),t);
  await p.getByRole('button',{name:'开启自动轮播',exact:true}).click();await p.getByRole('navigation',{name:'主要导航'}).getByRole('button',{name:'搜索',exact:true}).click();await p.waitForTimeout(100);const v=await title();await p.clock.fastForward(13000);assert.equal(await title(),v);
 });
 await p.goto(base);await p.locator('.feature-copy h1').waitFor();
 await check('减少动态效果禁用自动轮播与3D位移',async()=>{
  await p.emulateMedia({reducedMotion:'reduce'});await p.getByRole('button',{name:'减少动态效果已停用自动轮播'}).waitFor();const t=await title();await p.clock.fastForward(13000);assert.equal(await title(),t);await p.getByRole('button',{name:'下一部焦点影片'}).click();assert.notEqual(await title(),t);
 });
 await p.emulateMedia({reducedMotion:'no-preference'});
 for(const width of [390,320]){
  await p.setViewportSize({width,height:844});await p.goto(base);await p.locator('.feature-copy h1').waitFor();
  await p.getByRole('button',{name:'下一部焦点影片'}).click();await p.waitForTimeout(450);await p.mouse.move(0,0);await p.locator('.media-brand').focus();await p.clock.fastForward(6500);await p.waitForTimeout(450);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const geometry=await p.locator('.feature-mobile-rail').evaluate(el=>{const cards=[...el.children];const closest=cards.reduce((best,card)=>Math.abs(card.offsetLeft+card.offsetWidth/2-el.scrollLeft-el.clientWidth/2)<Math.abs(best.offsetLeft+best.offsetWidth/2-el.scrollLeft-el.clientWidth/2)?card:best,cards[0]);return closest.getAttribute('aria-label')});
  assert.equal(geometry,'查看'+await title());checks.push(`手机${width}自动切换与位置同步`);
 }
 assert.deepEqual(errors,[]);await writeFile(output+'results.json',JSON.stringify({checks,errors},null,2));
}finally{await browser.close()}
