# Node 后端源兼容验收（2026-10-30）

本次完成首阶段三个真实饭太硬普通站点的 Node 原生接入。一个 Node 服务提供原 API、静态页面、站点解析和媒体转发；无需 Android、Java 或第二个常驻服务。截图中的其他来源是后续兼容范围，尚未全部实现。

## 真实浏览器验收

隔离 Chrome 使用实际公开订阅、站点接口和媒体，没有替换或模拟响应。各站点从分类或搜索结果进入详情，播放第一集、拖动、切至第二集、保存约 20 秒位置，再刷新验证恢复。

| 站点 key | 真实影片 | 媒体宽度 | 保存位置 | 刷新恢复 | 结果 |
| --- | --- | --- | --- | --- | --- |
| 光影 | 伟大的长征（148627） | 1920 px | 20.09 s | 20.13 s | 通过 |
| 奶酪 | 庆余年 第一季（35200） | 1920 px | 20.08 s | 20.10 s | 通过 |
| 热播 | 庆余年 第二季（54444） | 1920 px | 20.07 s | 20.10 s | 通过 |

桌面视口 1280×800，三个站点均通过，最终运行没有 API 失败或页面异常。手机模拟视口 390×844 另验热播，刷新恢复至 20.09 s；这不是手机真机验收。

光影通过分类进入；其实际 wd 搜索明确返回“暂不支持搜索”，已关闭搜索能力。奶酪和热播通过“庆余年”搜索进入。热播验收为原始线路索引 0（线路二），没有用其他站点替换。

原始结果与截图：`.scratch/backend-compatibility/browser-v2/`；手机：`browser-mobile/`。复跑入口：`scripts/verify-fantaiying-web.mjs`。需已授权的独立实例、Chrome 与 Playwright，使用 `TVBOX_PREVIEW`、`PLAYWRIGHT_MODULE`、`TVBOX_TEST_SITE`、`TVBOX_TEST_WIDTH` 和 `TVBOX_EVIDENCE_DIR` 指定环境。

另验真实失败恢复：热播原始线路索引 3 返回解析失败，页面显示真实错误；从“选集与线路”改选索引 1 后，实际解码为 1920px、时间推进至 0.52s、17 帧，并能返回影片详情。证据为 `.scratch/backend-compatibility/browser-recovery.json`。同名集换线会自动播放，不能要求再次点击已关闭的选集面板。

## 代码与自动验证

- `npm test`：84/84，通过配置身份、签名、原集序、解析取消、受限端口、HLS 嵌套/密钥/初始化片段、Range、长片有效期与已有观看行为。隔离测试不能证明所有第三方影片长期在线。
- `npm run typecheck`：通过。
- `npm run build -- --outDir .scratch/backend-compatibility/dist`：通过。仅独立目录；原 `dist/` 未覆盖。video.js 约 714 kB 分块的体积提示仍存在。
- `npm run verify:production -- --root .scratch/backend-compatibility/dist`：通过真实 HTTP 静态入口、缓存、健康检查、片库和拒绝路径。默认参数行为保持原样。
- 单 Node 空载生产实例一次测量：初始化约 242 ms，健康检查约 8 ms，RSS 约 83 MiB；不是媒体并发压测。独立临时实例正常关闭，结果见 `runtime-check.json`。

## 实播发现与修复

- 奶酪：代理未提供 User-Agent 时媒体返回 403；统一补充基础请求头，并保留站点解析返回的专用 UA。
- 热播：解析接口使用已核实的非标准端口，返回的公网媒体 IP 会轮换。媒体授权绑定本次具体 origin，私网及未核实端口仍被拒绝。
- 热播：`getM3u8` 无扩展名且返回 `application/octet-stream`，原检测未改写分片。现在依据受控解析契约及 HLS 标签逐层标记并改写，不将原始 HTTP 分片交给浏览器。
- 光影续播：两集 HLS 的登记数量可能超过旧 5000 上限。已改为 50000 的有界容量、按分钟清理、同一清单共享活动期，避免登记每个分片都扫描全表或长电影后段失效。
- 早期浏览器脚本误选缓存隐藏面板，已限制到可见选集面板。旧失败证据保留，不能视为产品切集失败或覆盖最终通过记录。

## 未完成与条件

- 截图参考的其他普通影视、预告片、直播和网盘来源未完成。公开配置身份与分组见 [Spider 兼容范围](../product/spider-source-coverage.md)。
- 热播其他线路存在解析上游“秘钥不存在”、连接超时等现象；不能把线路 0 成功扩大为全线路成功。
- 未验证全片长时间播放、多家庭并发、全部影片、真实手机、网盘扫码和授权播放。
- 没有更新家庭服务、发布、提交或推送；隔离预览仅在本机 `http://127.0.0.1:5194` 提供。

## 来源与恢复

饭太硬配置使用现有内置公开地址，保留原 key、api 和 ext 身份。接口参考固定上游 [jo32/tvbox-silicon](https://github.com/jo32/tvbox-silicon/tree/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/ScriptAssets/sites)。配置解码器保留上游实现与 GPL-3.0-only 许可，见 `server/adapters/FTY-LICENSE`。归档 SHA-256 为 `4f78071be83ac174b0cec43e0ef62ee86355e3f5bae7341e6179e3c22009e9b6`。

仓库无初始提交，不能用 Git reset 恢复。82 个原文件的源码基线及 SHA-256 位于 `.scratch/backend-compatibility/baseline/` 与 `baseline-sha256.json`。旧 Java 原型仅保留在 `abandoned-java-prototype/`，不在生产启动链路。
