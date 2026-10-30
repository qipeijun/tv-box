// 隔离数据与本机短片验证页面和交互，不代表真实线路播放验收。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');const assert=require('node:assert/strict');
const base=process.env.TVBOX_PREVIEW || 'http://127.0.0.1:5192';
const out=new URL('../docs/development/screenshots/separate-viewing-layouts/', import.meta.url).pathname;
fs.mkdirSync(out,{recursive:true});
const media=fs.readFileSync(process.env.TVBOX_TEST_MEDIA || '/tmp/tvbox-polish-qa.mp4');
const episodes=Array.from({length:65},(_,i)=>({id:`0:${i}`,name:`第${i+1}集`,url:`${base}/__polish.mp4`,mime:'video/mp4',reason:''}));
const film={id:'polish',name:'燃烧吧！爸爸：很长的影片名称用于检查标题与返回区域',poster:null,remarks:'更新至65集',year:'2026',category:'剧集',area:'中国大陆',language:'国语',actors:'演员甲 / 演员乙',director:'导演',description:'此为隔离布局测试内容，不代表真实影片资料。'.repeat(18),lines:[{name:'线路一',episodes}]};
const sub={id:'polish-session',revision:'v1',name:'验证片库',fetchedAt:'2026-10-30T00:00:00Z',sites:[{key:'main',name:'验证站点',supported:true,searchable:true,reason:''}],livePlaylists:[]};
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});const results=[];
try {for(const width of [1440,800,390,320]){
let artworkCase=false;
const mobile=width<700;const c=await browser.newContext({viewport:{width,height:900},hasTouch:mobile,deviceScaleFactor:mobile?3:1,reducedMotion:'reduce'});
await c.route('**/__polish.mp4',r=>{const range=r.request().headers().range; const start=Number(range?.match(/bytes=(\d+)/)?.[1]||0);return r.fulfill({status:range?206:200,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${media.length-1}/${media.length}`}:{})},body:media.subarray(start)});});
await c.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;const json=v=>r.fulfill({contentType:'application/json',body:JSON.stringify(v)});
if(path==='/api/subscriptions')return json(sub);
if(path==='/api/builtins')return json({subscriptions:[{id:'curated',name:'验证片库',description:'隔离测试',checkedAt:'2026-10-30',source:'https://example.com'}]});
if(path.includes('/metadata')) {
 const metadata={provider:'tvmaze',id:'7135',name:'琅琊榜',year:'2015',poster:'https://static.tvmaze.com/uploads/images/original_untouched/69/174608.jpg',background:'https://static.tvmaze.com/uploads/images/original_untouched/220/551639.jpg',rating:null,ratingLabel:'',url:'https://www.tvmaze.com/shows/7135/nirvana-in-fire',attribution:'图片：TVmaze · 隔离布局预览',warnings:[],runtime:'',released:'',directors:[],cast:[]};
 return json(artworkCase ? (path.endsWith('/search')?{candidates:[metadata]}:metadata) : {candidates:[]});
} 
if(path.endsWith('/categories'))return json({categories:[{id:'1',name:'剧集'}]});
if(path.endsWith('/videos/polish'))return json({film:artworkCase?{...film,name:'琅琊榜',year:'2015',remarks:'8 集 · 预览数据',lines:[{name:'测试线路',episodes:episodes.slice(0,8)}],poster:'https://static.tvmaze.com/uploads/images/original_untouched/69/174608.jpg',description:'隔离布局预览，使用 TVmaze 的真实影片图片检查构图。播放线路和集数为测试数据，不代表影片的实际资源。',actors:'',director:''}:film});
if(path.includes('/videos'))return json({films:[film],pagination:{page:1,pages:1,total:1}});
return json({});});
const p=await c.newPage();p.on('pageerror',e=>results.push({error:e.message}));
await p.goto(base+'/#film=polish');await p.locator('.film-actions [data-variant="default"]').waitFor();
assert.equal(await p.locator(mobile?'.film-mobile':'.film-desktop').count(),1);
assert.equal(await p.locator(mobile?'.film-desktop':'.film-mobile').count(),0);
await p.getByRole('button',{name:'收藏影片',exact:true}).click();assert.ok(await p.getByRole('button',{name:'取消收藏',exact:true}).getAttribute('aria-pressed')==='true');
await p.getByRole('button',{name:'展开简介',exact:true}).click();assert.equal(await p.getByRole('button',{name:'收起',exact:true}).getAttribute('aria-expanded'),'true');
await p.getByRole('button',{name:'收起',exact:true}).click();
await p.evaluate(()=>scrollTo(0,0));
let m=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(m.scroll<=width+1,JSON.stringify(m));
await p.screenshot({path:`${out}/detail-${width}.png`,fullPage:true});
await p.locator('.film-actions [data-variant="default"]').click();await p.locator('.cinema-player').waitFor();
await p.waitForFunction(()=>document.querySelector('video')?.currentTime>0.1);
await p.mouse.move(width / 2, mobile ? 90 : 160);
await p.waitForFunction(()=>document.querySelector('.cinema-controls')?.getAttribute('data-visible')==='false');
const hiddenNav=p.locator(mobile?'.player-mobile-navigation':'.player-desktop-navigation');
assert.equal(await hiddenNav.getAttribute('inert'),'');
await p.waitForFunction(()=>getComputedStyle(document.querySelector('.player-mobile-navigation, .player-desktop-navigation')).visibility==='hidden');
await p.mouse.move(width / 2 + 20, mobile ? 95 : 170);
await p.getByRole('button',{name:'暂停',exact:true}).click();
const nav=p.locator(mobile?'.player-mobile-navigation':'.player-desktop-navigation');
const b=await nav.locator('button').boundingBox(),t=await nav.locator('h1').boundingBox();assert.ok(b.x+b.width<=t.x,'返回与标题重叠');assert.ok(b.width>=48&&b.height>=48);
assert.equal(await p.locator('.watch-inline-episodes').count(),mobile?1:0);
await p.screenshot({path:`${out}/player-${width}.png`});
await p.getByRole('button',{name:'选择集数和线路'}).click();
if(mobile){assert.ok(await p.locator('.watch-inline-episodes').isVisible());await p.locator('.watch-inline-episodes .episode-tile').nth(1).click();}
else {await p.locator('.watch-episodes-dialog .episode-tile').nth(1).click();}
await p.waitForURL(/episode=0%3A1/);await p.waitForFunction(()=>document.querySelector('video')?.currentTime>0.1);
await p.getByRole('button',{name:'暂停',exact:true}).click();await p.getByRole('button',{name:'全屏',exact:true}).click();
assert.ok(await p.evaluate(()=>!!document.fullscreenElement));await p.getByRole('button',{name:'选择集数和线路'}).click();await p.getByRole('button',{name:'关闭选集',exact:true}).click();await p.getByRole('button',{name:'退出全屏',exact:true}).click();
if(mobile){await p.setViewportSize({width:844,height:390});assert.equal(await p.locator('.player-mobile-navigation').count(),1);await p.screenshot({path:`${out}/landscape-${width}.png`});await p.setViewportSize({width,height:900});}
await p.getByRole('button',{name:'返回影片',exact:true}).click();await p.waitForURL(/film=polish/);assert.ok(p.url().includes('episode=0%3A1'));
if(!process.env.TVBOX_SKIP_ARTWORK && (width===1440 || width===390)) {
 artworkCase=true;await p.reload();
 await p.waitForFunction(isMobile=>document.querySelector(isMobile ? '.film-mobile-cover img' : '.film-desktop-scene img')?.naturalWidth>450,mobile,{timeout:45000});
 await p.locator(mobile ? '.film-mobile-cover img' : '.film-desktop-scene img').evaluate(async img=>{await img.decode();});
 await p.screenshot({path:`${out}/artwork-${width}.png`,fullPage:true});
 if(!mobile) {
   assert.equal(await p.getByRole('button',{name:'向后浏览集数'}).count(),0);
   const tiles=p.locator('.detail-episodes .episode-tile');
   assert.equal(await tiles.count(),8);
   assert.equal(await tiles.first().innerText(),'第1集');
   const box=await tiles.first().boundingBox();
   assert.ok(box.height>=44 && box.height<=60,'文字选集不应保留缩略图高度');
   const grid=await p.locator('.detail-episodes .episode-tiles').evaluate(e=>({scroll:e.scrollWidth,width:e.clientWidth}));
   assert.ok(grid.scroll<=grid.width+1,'文字选集应换行而非横向滚动');
   await p.setViewportSize({width:2560,height:900});
   await p.waitForFunction(()=>!document.querySelector('.film-desktop-hero').hasAttribute('data-has-backdrop'));
   const poster=p.locator('.film-desktop-scene img');
   await poster.evaluate(img=>img.decode());
   assert.ok((await poster.boundingBox()).width<=200);
   await p.screenshot({path:`${out}/poster-fallback-wide.png`});
   await p.setViewportSize({width:1440,height:900});
   await p.waitForFunction(()=>document.querySelector('.film-desktop-hero').hasAttribute('data-has-backdrop'));
   const session=await c.newCDPSession(p);
   await session.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:2,mobile:false});
   await p.waitForFunction(()=>!document.querySelector('.film-desktop-hero').hasAttribute('data-has-backdrop'));
   await p.screenshot({path:`${out}/poster-fallback-retina.png`});
   await session.send('Emulation.clearDeviceMetricsOverride');
   results.push({check:'artwork-density-and-resize',passed:true});
 }
 if(!process.env.TVBOX_SKIP_ARTWORK && (width===1440 || width===390)) {
   await c.route('https://static.tvmaze.com/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#8494a4"/><text x="20" y="150" fill="white">Low resolution test</text></svg>'}));
   await p.reload();
   await p.waitForFunction(isMobile=>{
     const root=document.querySelector(isMobile?'.film-mobile':'.film-desktop');
     const img=root?.querySelector(isMobile?'.film-mobile-cover img':'.film-desktop-scene img');
     return img?.naturalWidth===200 && (isMobile?root.hasAttribute('data-compact-artwork'):!root.querySelector('.film-desktop-hero').hasAttribute('data-has-backdrop'));
   },mobile);
   const size=await p.locator(mobile?'.film-mobile-cover img':'.film-desktop-scene img').boundingBox();
   const density=await p.evaluate(()=>devicePixelRatio);
   assert.ok(size.width*density<=201,'低清海报不得按物理像素放大');
   results.push({check:`low-resolution-${width}`,passed:true});
 }
}
await p.goto(base+'/');
const card=p.locator('.poster-card').first();
await card.waitFor();
await card.hover();
assert.equal(await p.locator('.poster-play').count(),0,'海报不应再显示圆形浮层');
await card.focus();
assert.notEqual(await card.evaluate(el=>getComputedStyle(el).outlineStyle),'none','保留键盘焦点提示');
await p.screenshot({path:`${out}/poster-hover-${width}.png`});
results.push({navigationAutoHide:true,posterHover:true,width,layout:mobile?'mobile':'desktop',detailOverflow:false,navigationOverlap:false,favorite:true,expandSynopsis:true,switchEpisode:true,fullscreen:true,returnEpisode:true});await c.close();
}assert.ok(!results.some(x=>x.error),JSON.stringify(results));fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
