# 映场 · TVBox Web

个人/家庭使用的媒体应用，Web 首发；电脑与手机分别排版，支持标准 CMS 点播、M3U 直播、多订阅、站内/跨站搜索、选集与换线、历史续播、自动连播和本机收藏。

## 家庭局域网

当前地址：[打开映场](http://192.168.11.154:4781)。已运行并经用户手机验证首页和播放。再次启动使用 `npm run start:lan`，读取本机 `.env.lan`；电脑 IP 变化时需更新配置。详见 [家庭运行说明](docs/deployment/home-lan.md)。

## 本机运行

需要 Node.js 22.19 或更新版本。

```sh
npm ci
npm test
npm run build
npm run verify:production
npm start
```

打开 http://127.0.0.1:4781。默认仅本机可访问；启动前检查并复用已有服务。开发使用 `npm run dev`，Web 端口 5190、API 端口 4781。

- [运行、源兼容和操作说明](docs/development/local-run.md)
- [局域网、域名部署、验证与回滚](docs/deployment/web-v1.md)
- [产品规格](docs/product/web-v1-spec.md)
- [交互设计语言](docs/design/web-design-language.md)
- [集成与生产验证记录](docs/development/integration-2026-10-30.md)
- [任务进度](.scratch/web-v1/map.md)

## 边界

标准 CMS 媒体经后端登记转发；饭太硬已接入光影、奶酪、热播、糯米以及荐影预告片的 Node 后端适配、按集解析与同源媒体转发，包含 HLS 子清单、分片、密钥和 MP4 Range。无需 Android、Java 或第二个常驻服务，不在本机转码。未知 Spider 仍显示具体原因，不执行订阅里的任意脚本或 Android JAR。真实支持与后续源清单见 [Spider 兼容范围](docs/product/spider-source-coverage.md)。

新增独立“公开网盘片库”的 KK 公共接口与夸克本人扫码入口；本人账号已验证两集实播、切集、拖动、刷新续播及两个独立浏览器并发，独立验收副本的退出撤销也已通过。不等同于旧抠抠插件兼容。后端保存一份家庭共享网盘授权，仅在必要时转存所选文件，活动播放不会被清理。凭据目录、清晰度与过期清理的验收边界见 [网盘运行说明](docs/development/cloud-drive.md)。

应用没有用户账号与跨设备资料同步；收藏、历史、订阅按当前浏览器 origin 保存。更换域名、端口或设备不会自动迁移。公开部署须自行配置入口访问控制。真实域名发布和手机真机结果与本机测试分别记录，不保证所有第三方源长期可用。
