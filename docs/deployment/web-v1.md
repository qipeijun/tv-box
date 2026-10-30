# Web 首版部署与回滚

## 已验证的交付方式

应用是 Node.js 服务加前端构建，不能只上传静态页面；订阅、点播接口与直播列表由同源后端读取。媒体清单、分片、密钥与字节范围请求仍由浏览器直连第三方，没有媒体代理、转码或 Android Spider/JAR。

Node.js 至少 22.19，当前本机验证版本 26.7.0。使用锁文件安装：

```sh
npm ci
npm test
npm run build
npm run verify:production
npm start
```

默认只监听 127.0.0.1:4781。启动前确认端口未被占用；不要结束其他项目或正在观看的服务。生产入口缺少 dist/index.html 时明确失败并提示构建。

`verify:production` 使用实际 dist，另起回环临时端口并在结束后关闭，验证入口/哈希资源、健康检查、内置片库和拒绝路径；不重启现有服务、不访问第三方媒体，不等于公网发布完成。

## 局域网访问

将示例地址替换为服务器实际局域网地址：

```sh
TVBOX_HOST=0.0.0.0 TVBOX_PORT=4781 TVBOX_ORIGINS=http://192.168.1.10:4781 npm start
```

手机与服务器在可互通网络中访问同一个地址。允许入口必须包含协议、域名/IP、非默认端口；多个用逗号分隔。监听 0.0.0.0 不会自动允许所有 Host。服务监听 IP 与对外页面地址分开配置，不信任任意转发头。

也可复制 .env.example 到 .env，填写后显式加载：

```sh
node --env-file=.env server/index.js
```

`.env` 必须包含 NODE_ENV=production；`npm start` 使用进程环境，不自动读取该文件。示例不包含真实域名、凭据或订阅。

## 域名与反向代理

Node 服务继续绑定回环地址，允许浏览器实际访问的 HTTPS origin：

```sh
TVBOX_HOST=127.0.0.1 TVBOX_PORT=4781 TVBOX_ORIGINS=https://tv.example.com npm start
```

反向代理将同一域名的全部路径转发到 Node，包括 /api、/assets 和 /。例如以下 Nginx server 内的 location 配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:4781;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
}
```

TLS 证书和 server_name 由部署环境配置。应用按真实 Host 与 Origin 精确校验，不使用 X-Forwarded-Host 扩大允许范围；不要替换成通配 CORS。当前环境未安装 Nginx，本片段是待部署环境检验的模板，不是已完成的代理发布。应用没有账号和访问控制，公开入口应由私有网络或反向代理的访问控制保护。

HTTPS 页面可能阻止 HTTP 媒体、外站 CORS 或不支持的编码；反代应用不会改变浏览器到媒体站的请求。出现此类失败应保留来源信息并换线/换站，不能宣称所有片源可用。

## 运行检查

本机健康检查需要页面标识：

```sh
curl -fsS -H 'X-TVBox-Client: web-v1' http://127.0.0.1:4781/api/health
```

返回 {"ok":true}。检查实际域名路径时，还要验证首屏和 JS/CSS、订阅导入、详情、真实播放与返回。API 请求无页面标识、未知 Host、未配置的 Origin 会返回 403；配置错误先检查 origin，不应直接移除校验。

后端快照保存在内存，重启后前端根据浏览器选择重建订阅。收藏、历史与自定义订阅保存在浏览器，按 origin 隔离；从 localhost 换成局域网 IP、修改端口或切换域名后不会自动迁移。旧地址的数据仍在原浏览器存储中；当前没有跨设备同步。

## 更新与回滚

- 更新前备份项目版本、锁文件及 dist，并记录允许的 origin；变更只在验证通过后进入实际服务目录。
- index.html 使用 no-cache；哈希 JS/CSS 使用一年 immutable。构建保留已有哈希资源，避免正在打开的页面后续加载旧模块时 404。
- 不在正在服务的目录执行删除 dist 或删除旧 assets 的清理。部署多个发布目录时，需要将仍在使用的旧哈希资源一并保留到新目录；仅切换到空的新目录会破坏老标签。
- 回滚同时恢复旧前端入口与匹配后端，并保留当前和旧版本的哈希资源；不要只回滚 index.html 却删除新标签仍可能使用的资源。
- 重启由部署方选择合适时机。优雅退出关闭 HTTP 服务；浏览器媒体直连不会被后端主动终止，但在途接口可能需要重试。内存会话重建不等于浏览器记录被删除。

当前已完成家庭局域网启动与用户手机真机基本验收，记录见下节。没有执行公网域名发布或反向代理服务器安装，不用本机注入测试代替这些额外部署方式。

## 当前采用的运行环境

用户已选择家庭局域网；已启动并经手机真机反馈验证，当前地址与启动命令见 [家庭局域网运行](home-lan.md)。上述公网域名和反代章节为其他部署方式的预备说明，不是当前家庭运行的阻塞项。
