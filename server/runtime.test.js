import { request } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readServerConfig } from "./config.js";
import { createWebServer } from "./runtime.js";

test("生产服务缺少构建时拒绝启动；静态缓存与 API 访问校验在真实 HTTP 下生效", async t => {
  const root=await mkdtemp(join(tmpdir(),"tvbox-runtime-"));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const config=readServerConfig({NODE_ENV:"production",TVBOX_ORIGINS:"https://tv.example.com"});
  await assert.rejects(()=>createWebServer(config,{root,logger:false}),/npm run build/);
  await mkdir(join(root,"assets"));
  await writeFile(join(root,"index.html"),'<!doctype html><script src="/assets/app-abc123.js"></script>');
  await writeFile(join(root,"assets/app-abc123.js"),'console.log("runtime smoke")');
  const app=await createWebServer(config,{root,logger:false});
  t.after(()=>app.close());
  await app.listen({host:"127.0.0.1",port:0});
  const address=app.server.address();
  const base=`http://127.0.0.1:${address.port}`;
  const html=await fetch(base);
  assert.equal(html.status,200);
  assert.equal(html.headers.get("cache-control"),"no-cache");
  const asset=await fetch(`${base}/assets/app-abc123.js`);
  assert.equal(asset.headers.get("cache-control"),"public, max-age=31536000, immutable");
  assert.equal(await asset.text(),'console.log("runtime smoke")');
  const headers={host:"tv.example.com",origin:"https://tv.example.com","x-tvbox-client":"web-v1"};
  const health = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/health`, {headers}, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({status: response.statusCode, body: JSON.parse(body)}));
    });
    req.on("error", reject);
    req.end();
  });
  assert.deepEqual(health, {status: 200, body: {ok:true}});
  assert.equal((await fetch(`${base}/api/health`)).status,403);
  assert.equal((await app.inject({url:"/api/absent",headers})).statusCode,404);
});
