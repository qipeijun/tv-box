# Apple TV 观影升级验证

日期：2026-10-30。仅本地实现与验证，未 commit、push、构建、发布或部署。设计与官方参考见 [设计规格](../design/apple-tv-upgrade-spec.md)。

## 交付内容

首页把影片放在来源与分类之前，缩短手机焦点区，首屏可以继续发现片架；保留收藏与观看历史。海报提示改为详情图标，片架箭头根据真实滚动边界禁用。

浏览与搜索沿用一套主导航，移除页内重复的首页／片库入口。搜索按输入、紧凑范围、单行进度、影片结果组织；来源身份保留，状态详情默认折叠。已有结果可立即操作；失败仍显示真实错误与重试。来源计数区分“已完成（含失败）”与“失败”，不把失败称作仍在等待。

详情保留独立页面，手机将竖海报与片名并排，播放／继续观看、选集、收藏随后呈现。缺图和加载骨架使用相同空间。返回具有可见文字；播放页加载、错误与播放器模块加载均提供相同位置的退出入口。

播放器按触摸按下前的可见性决定点击显隐，避免按下唤出后点击立即收回。触摸移动不触发鼠标式唤出，鼠标停留在控件上不自动隐藏；按下操作、键盘焦点、暂停与失败仍保持控件可用。页面／面板只使用短暂进入反馈，减少动态效果时取消动画。没有替换播放引擎、改接口或存储格式。

## 基线与运行环境

- Node v26.7.0、npm 11.19.0。初始与最终 `npm test` 均为 71/71，通过 `npm run typecheck`。
- 初始源码完整备份在 `.scratch/apple-tv-upgrade/baseline/src/`，原指纹在 `baseline/sha256.json`；本轮 9 个源码文件的指纹在 `current-sha256.json`。未执行 reset／clean。
- 原 5190 Vite 与 4781 API 均确认 cwd 为本仓库。检查发现 5190 仍返回缓存的旧模块，不能作为改后证据。原服务未停止；另启本轮临时 5192 Vite，curl 核对当前模块与最终样式。
- 5192 的来源会被现有 API 的 Origin 校验拒绝。本轮没有改服务端或允许列表：真实验收在独立 Chromium 上下文访问原 5190 Origin，仅把前端资源映射至 5192，API 与真实媒体照常请求。隔离数据回归直接访问 5192，并仅在该上下文拦截 API。
- `before-*` 是原 5190 在执行前实际可见界面；它可能带有旧服务缓存，不能冒充逐字匹配源码备份的构建产物。`after-*` 来自已核实当前模块的临时服务。真实片库内容随时间变化，截图并非同一静态数据集。

## 自动化与浏览器证据

| 检查 | 实际结果与证据 |
| --- | --- |
| 现有单元测试、类型检查 | 71/71，无新增类型错误；本轮无依赖／打包修改，按约定未运行 build 或 verify:production |
| 1280×800、390×844、320×844 | 首页、浏览、站内／跨站搜索、收藏、历史、详情、播放无页面横向溢出；见 interaction-results.json |
| 分类与返回 | 分类第二页进入详情，返回保留 category、page 与海报焦点 |
| 15 条入口链路 | 三个宽度分别从首页、站内搜索、跨站搜索、收藏、历史进入，播放、切集、切线后浏览器后退回详情，再页面返回原入口；查询保留，无切集历史堆叠 |
| 播放控制 | 隔离 60 秒本机短片：暂停、继续、前后10秒、实际鼠标拖动进度、键盘调整、全屏进出；打开选集保持原 video 节点 |
| 触控与悬停 | 实际触摸模拟从隐藏态唤出控件；鼠标停留控件超过自动隐藏周期仍可操作，主要按钮至少44×44；见 controls-results.json |
| 搜索异常 | 隔离部分成功、空结果、全部来源失败；已有结果可见、错误按需展开；见 fixture-cross-* 图片与结果 JSON |
| 搜索改词与减少动态效果 | 修改输入并提交后结果更新、URL保持新查询；减少动态效果下页面动画为none，见 controls-results.json |
| 媒体重试 | 隔离媒体502后真实错误界面出现，恢复短片响应并点击重试，时间继续推进 |
| 详情失败 | 隔离失败后仍可返回影片，无丢失退出入口 |
| 真实剧集 | 非凡站点影片99329、第01集，在三个宽度真实播放时间推进；不是本机短片，数字见 real-results.json |
| 真实电影 | 跨站搜索实际返回的《流浪地球》进入详情、选择播放，时间1.02→2.23秒，返回原跨站查询；见 real-movie-results.json |
| 横屏与全屏 | 844×390、标准 Fullscreen API 进出通过，截图见 after-player-landscape／fullscreen |
| 直播与片库管理 | 390px 实际页面加载、共享导航与无横向溢出通过；直播频道列表可见。本轮不据此宣称所有直播频道可播放 |

交互回归使用构造的影片、长标题、缺图、两条线路和本机短片；只证明状态与交互，不证明任何第三方来源可用。短片请求需支持 Range，最初错误的测试响应已修正；没有删测试或放宽业务断言。历史直接续播与隐藏首页同时保留同一收藏卡片均按现有契约定位，未因此改业务行为。

## 截图对照

[所有截图与结果](screenshots/apple-tv-upgrade/)。

| 页面 | 改前 | 改后 |
| --- | --- | --- |
| 手机首页 | [改前](screenshots/apple-tv-upgrade/before-home-390.png) | [改后](screenshots/apple-tv-upgrade/after-home-390.png) |
| 桌面搜索 | [改前](screenshots/apple-tv-upgrade/before-search-1280.png) | [改后](screenshots/apple-tv-upgrade/after-search-1280.png) |
| 手机详情 | [改前](screenshots/apple-tv-upgrade/before-detail-390.png) | [改后](screenshots/apple-tv-upgrade/after-detail-390.png) |
| 手机播放 | [改前](screenshots/apple-tv-upgrade/before-player-390.png) | [改后](screenshots/apple-tv-upgrade/after-player-390.png) |

## 复跑

启动／复用项目服务后，在可启动 Chrome 的环境运行；Playwright 可用本机已有模块，不安装到产品依赖。

```sh
PLAYWRIGHT_MODULE=/绝对路径/playwright CHROME_PATH=/绝对路径/Chrome node scripts/verify-apple-tv-upgrade.mjs
TVBOX_CONTROLS_ONLY=1 PLAYWRIGHT_MODULE=/绝对路径/playwright CHROME_PATH=/绝对路径/Chrome node scripts/verify-apple-tv-upgrade.mjs
PLAYWRIGHT_MODULE=/绝对路径/playwright CHROME_PATH=/绝对路径/Chrome node scripts/capture-apple-tv-upgrade.mjs
```

隔离交互脚本的 `TVBOX_TEST_MEDIA` 指向本机60秒 MP4（本次 `/tmp/tvbox-design-qa.mp4`，不是交付媒体）。默认临时前端 `TVBOX_PREVIEW=http://127.0.0.1:5192`，真实 API Origin 为 `TVBOX_ORIGIN=http://127.0.0.1:5190`。真实来源有外部波动，失败时保留错误并按实际原因记录，不能用隔离短片替代真实验收。

## 限制与范围外

无 iOS／Android 真机、Safari／WebKit 原生全屏与实机手感证据；无全站媒体兼容性、长时间性能或线上发布结论。手机为 Chromium 视口与触摸模拟。没有引入遥控导航、账号同步、新来源、媒体代理、转码或新组件库。

原 5190 服务仍有旧模块缓存。要直接查看最新开发页面，需要由该服务的所有者刷新／重启；临时 5192 直接访问仍受 API 现有 Origin 限制。本次采用隔离资源映射完成验收，没有替用户重启原服务或修改服务端安全配置。
