import { test } from "node:test";
import assert from "node:assert/strict";
import { readServerConfig } from "./config.js";
import { createApp } from "./app.js";

test("默认监听本机；改端口同步本机入口，部署 origin 显式允许且规范去重", () => {
  const defaults = readServerConfig({});
  assert.equal(defaults.host, "127.0.0.1");
  assert.equal(defaults.port, 4781);
  assert.equal(defaults.production, false);
  const config = readServerConfig({ TVBOX_HOST: "0.0.0.0", TVBOX_PORT: "4899", TVBOX_ORIGINS: "https://tv.example.com/,http://192.168.1.10:4899,https://tv.example.com", NODE_ENV: "production" });
  assert.equal(config.production, true);
  assert.ok(config.origins.includes("http://127.0.0.1:4899"));
  assert.equal(config.origins.filter(value => value === "https://tv.example.com").length, 1);
  for (const env of [ {TVBOX_PORT:"0"}, {TVBOX_PORT:"65536"}, {TVBOX_PORT:"1.5"}, {TVBOX_HOST:"*"},
    ...["*", "null", "https://*.example.com", "https://tv.example.com/path", "https://user:pass@tv.example.com", "https://tv.example.com?q=1", "https://tv.example.com#x", "file:///tmp", "https://tv.example.com,"].map(TVBOX_ORIGINS=>({TVBOX_ORIGINS}))])
    assert.throws(()=>readServerConfig(env));
});

test("部署 origin 支持真实 Host 与反代本机 Host，但不信任伪造转发头或相似域名", async t => {
  const config = readServerConfig({TVBOX_PORT:"4899", TVBOX_ORIGINS:"https://tv.example.com,http://192.168.1.10:4899"});
  const app = createApp({logger:false,allowedOrigins:config.origins});
  t.after(()=>app.close());
  for (const host of ["tv.example.com","127.0.0.1:4899","192.168.1.10:4899"]){
    const response=await app.inject({url:"/api/health",headers:{host,origin:"https://tv.example.com","x-tvbox-client":"web-v1"}});
    assert.equal(response.statusCode,200);
  }
  for (const headers of [
    {host:"tv.example.com",origin:"https://tv.example.com.evil.org","x-tvbox-client":"web-v1"},
    {host:"evil.example",origin:"https://tv.example.com","x-tvbox-client":"web-v1","x-forwarded-host":"tv.example.com"},
    {host:"tv.example.com",origin:"null","x-tvbox-client":"web-v1"},
    {host:"tv.example.com",origin:"https://tv.example.com"},
  ]) assert.equal((await app.inject({url:"/api/health",headers})).statusCode,403);
});
