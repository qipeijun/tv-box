import assert from "node:assert/strict";
import { request } from "node:http";
import { readServerConfig } from "../server/config.js";
import { createWebServer } from "../server/runtime.js";
import { resolve } from "node:path";

// 仅启动独立回环临时端口，不重启正在观看的服务，也不请求第三方媒体。
const config = readServerConfig({NODE_ENV:"production",TVBOX_ORIGINS:"https://tv-smoke.example"});
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--root" || !args[1])) throw Error("用法：npm run verify:production -- [--root 构建目录]");
const app = await createWebServer(config, {logger:false, ...(args[1] ? { root: resolve(args[1]) } : {})});
function get(base, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, {headers}, res => {
      let body="";
      res.setEncoding("utf8");
      res.on("data",chunk=>{body+=chunk;});
      res.on("error",reject);
      res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,body}));
    });
    req.on("error",reject);
    req.end();
  });
}
try {
  await app.listen({host:"127.0.0.1",port:0});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const html=await get(base,"/");
  assert.equal(html.status,200);
  assert.equal(html.headers["cache-control"],"no-cache");
  const assets=[...html.body.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map(match=>match[1]);
  assert.ok(assets.length>=2,"构建入口缺少 JS 或 CSS。");
  for (const asset of assets) {
    const result=await get(base,asset);
    assert.equal(result.status,200,`${asset} 不可读取`);
    assert.match(result.headers["cache-control"],/immutable/);
    assert.ok(result.body.length>0);
  }
  const icon=html.body.match(/rel="icon"[^>]+href="([^"]+)"/);
  assert.ok(icon, "缺少站点图标。");
  assert.equal((await get(base,icon[1])).status,200);
  const headers={host:"tv-smoke.example",origin:"https://tv-smoke.example","x-tvbox-client":"web-v1"};
  const health=await get(base,"/api/health",headers);
  assert.equal(health.status,200);
  assert.deepEqual(JSON.parse(health.body),{ok:true});
  const builtins=await get(base,"/api/builtins",headers);
  assert.equal(builtins.status,200);
  assert.ok(JSON.parse(builtins.body).subscriptions.length>0);
  const imported=await get(base,"/api/health",{...headers,origin:"https://evil.example"});
  assert.equal(imported.status,403);
  const noClient=await get(base,"/api/health",{host:"tv-smoke.example"});
  assert.equal(noClient.status,403);
  console.log(`生产验证通过：实际 dist 入口及 ${assets.length} 个入口资源、域名请求、健康检查、内置片库与拒绝路径。`);
} finally {
  await app.close();
}
