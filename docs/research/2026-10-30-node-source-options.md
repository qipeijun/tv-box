# 饭太硬：单 Node 服务路线的源码与站点覆盖核查

> 后续实现：已从固定源码找到同站点适配依据，并在现有 Node 服务接入光影、奶酪、热播；三个站点完成真实网页播放、切集、定位和续播。见 [实现验收](../development/node-source-compatibility-2026-10-30.md)。本文仍保留早期只读研究的范围与结论，不能将其“未实播”误认为当前状态。

核查日期：2026-10-30。范围：公开源码、仓库元数据和无登录的只读 HTTP 请求；没有执行外部 JS/JAR，没有安装依赖、启动服务、登录网盘、转存文件或播放视频。

## 结论与证据边界

Node 可以把规则引擎、站点适配器和媒体代理放在同一个后端服务中，不必为了“影视站点解析”天然增加 Android 服务。但本次没有找到能直接加载饭太硬 Guard Dex 的 Node 实现，不能把“支持 JavaScript 规则”写成“兼容饭太硬 45 个 CSP”。

目前最清晰的两类材料是：作者维护的 **drpy3 规则引擎库**，以及第三方保存的 **drpyS/drpy-node 站点和网盘代码**。前者便于嵌入单服务，但不附带已验证的饭太硬站点覆盖；后者有真实的玩偶哥哥、立播、瓜子规则，仍存在站点地址失效、宿主依赖和许可证标注冲突。不能直接承诺拼接两者即可完整运行。

本项目订阅快照记录了 48 个 type=3 入口，其中 45 个 CSP、3 个 JavaScript。见 [订阅检查结果](../development/fantaiying-compatibility-probe-2026-10-30.json)，检查时间为 `2026-10-30T02:30:13.522Z`。本文的代表站点调查只覆盖厂长、立播、瓜子、海绵、玩偶哥哥，**不是 48 个入口的通过率统计**。

验证层级严格区分：

| 层级 | 本次获得的证据 | 不能推出的结论 |
| --- | --- | --- |
| 源码可读取 | GitHub/raw 能读取规则、依赖和实现 | 规则可以在本项目执行 |
| HTTP 可达 | 公共首页或 API 根路径响应 | 搜索、详情、解析接口有效 |
| 同站点身份 | 规则 URL、协议、选择器与订阅身份对照 | 名称相同就等价于 Guard |
| 功能执行 | 本次未执行规则 | 未验证搜索、详情、播放解析 |
| 媒体播放 | 本次没有浏览器或播放器测试 | 没有任何“已播放”结论 |

## 候选项目与单服务嵌入条件

### drpy3：可嵌入的引擎，不是饭太硬适配器集合

[作者仓库](https://github.com/hjdhnx/drpy3)提供实例式引擎及宿主接口：注入请求和 HTML 解析函数，再调用源的初始化、分类、搜索、详情和播放方法。`load2x` 对接旧 drpy2 规则；[兼容层源码](https://github.com/hjdhnx/drpy3/blob/e5b89fd779de2a7552feec74d5bd020962ccd2f2/src/drpy3/compat/drpy2.js)使用 JavaScript `new Function` 获取 `rule`，并没有 Android Dex/JAR 装载实现。没有证据表明该层等价支持全部 drpyS 的 `lang: ds` 异步规则及其网盘全局对象。

[package.json](https://github.com/hjdhnx/drpy3/blob/e5b89fd779de2a7552feec74d5bd020962ccd2f2/package.json)为 `0.1.0`，Node 范围是 `>21 <23`，开发依赖包含 Cheerio、esbuild；[LICENSE](https://github.com/hjdhnx/drpy3/blob/e5b89fd779de2a7552feec74d5bd020962ccd2f2/LICENSE)为 MIT。仓库最新提交核查为 `e5b89fd779de2a7552feec74d5bd020962ccd2f2`，提交时间 `2026-10-01T12:45:35Z`，见 [提交记录](https://github.com/hjdhnx/drpy3/commits/main)。版本范围是项目声明，不是本机兼容测试。

[Node 示例宿主](https://github.com/hjdhnx/drpy3/blob/e5b89fd779de2a7552feec74d5bd020962ccd2f2/cli/node-host.mjs)可以作为接入边界参考，但示例能够访问文件、网络和子进程，不能作为任意订阅脚本的隔离证明。实际集成需要用本项目受限网络请求、超时/大小限制及状态隔离替换示例能力。使用库本身不要求另起 HTTP 服务。

### CatPawOpen：有模块化 Node 插件，但代表站点覆盖不足

[CatPawOpen](https://github.com/CatPawApp/CatPawOpen)自述接续 CatVodOpen。检查到的最新提交为 `b956aedabe5f624f1e96c8d21c8866617a0f71c1`，时间 `2025-01-17T08:17:21Z`，见 [提交记录](https://github.com/CatPawApp/CatPawOpen/commits/main)。

[video 目录](https://github.com/CatPawApp/CatPawOpen/tree/main/nodejs/src/spider/video)和 [router.js](https://github.com/CatPawApp/CatPawOpen/blob/main/nodejs/src/router.js)中的视频插件是 `ffm3u8`、`kkys`、`kunyu77`、`push`，本次未找到上述五个代表站点的适配。路由使用 Fastify 插件注册，可迁入同一后端；但 [index.js](https://github.com/CatPawApp/CatPawOpen/blob/main/nodejs/src/index.js)负责创建服务、全局宿主接口、配置和数据库，因此不能直接调用原启动函数再称“单服务集成”。

[AList 模块](https://github.com/CatPawApp/CatPawOpen/blob/main/nodejs/src/spider/pan/alist.js)依赖 `server.config.alist` 和 AList 的 `/api/fs/list`、`/api/fs/get` 等接口。这证明了 AList 客户端适配，不等于自带无需外部服务的夸克、UC 或天翼分享解析。

[依赖文件](https://github.com/CatPawApp/CatPawOpen/blob/main/nodejs/package.json)包含 Fastify 4、Axios、Cheerio、CryptoJS、node-json-db 等，未声明 `license`。本次根目录 `LICENSE` 请求为 404，未找到明确仓库许可证，复用前需要确认许可范围。其嵌入式客户端 Node 运行限制不应被误读为标准服务器 Node 的限制。

### drpyS：有站点和网盘源码，但当前可访问材料是第三方快照

本次访问原地址 [hjdhnx/drpy-node](https://github.com/hjdhnx/drpy-node)及其 raw README 返回 404。不能据此断言项目永久关闭，也不能把搜索引擎缓存或第三方镜像称为当前官方版本。同一作者的 [drpy-node-house](https://github.com/hjdhnx/drpy-node-house)当前 README 描述的是 Bun/Fastify/Helia 文件存储与分发系统；它不是已确认的 drpyS 执行引擎后继。

可读取的 [Hululu007/drpy-node](https://github.com/Hululu007/drpy-node)仅按第三方镜像/快照处理。最新提交 `295f2b7047e14122d542a7736cb931e81abcf85c`，时间 `2026-03-22T13:10:19Z`，见 [提交记录](https://github.com/Hululu007/drpy-node/commits/main)。[package.json](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/package.json)版本 `1.4.3`，Node 范围 `>17 <24`；有 Fastify、Axios、CryptoJS、node-forge、node-sqlite3-wasm、node-pty、python-shell 等依赖。整仓依赖多，不代表每个站点都需要 Python 或原生模块；提取具体规则时需要沿调用链裁剪，不能只看包名定性。

该快照 **package.json 写 MIT，根 [LICENSE](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/LICENSE)却是 GPLv3**。本文不替它解决授权冲突，也不按 MIT 直接批准复制。drpy3 的 MIT 不能覆盖从其他仓库取得的规则。

## 五个代表站点：源码存在不等于当前饭太硬同源

补充读取当前订阅只提取字段名和公开站点地址，没有保存账号内容。玩偶 `ext` 只有 `Cloud-drive`；立播有 `Cloud-drive` 和 `siteUrl=https://www.libvio.pw/`；厂长、海绵、瓜子没有 `ext`。当前 Guard 静态材料未提供已解出的站点域名。因此除立播可做显式地址比较外，其余候选不能凭类名或显示名证明相同上游。

| 饭太硬入口 | 找到的具体规则及实现证据 | 与当前订阅的差距 |
| --- | --- | --- |
| 厂长 / `csp_NewCzGuard` | 作者旧 [dr_py/厂长资源.js](https://github.com/hjdhnx/dr_py/blob/main/js/%E5%8E%82%E9%95%BF%E8%B5%84%E6%BA%90.js)：`www.czzy88.com`，`/page/fypage?s=**` 搜索、`.bt_img` 列表和 `.videoplay` 播放页解析 | 是明确的厂长规则，但 Guard 未披露域名；旧规则首页本次跳转为发布页，不能认定可直接工作 |
| 立播 / `csp_LibvioGuard` | 快照 [立播[盘].js](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/spider/js/%E7%AB%8B%E6%92%AD%5B%E7%9B%98%5D.js)：`www.libvio.cc`，详情提取分享链接，调用 Quark/UC；旧官方 [LIBVIO.js](https://github.com/hjdhnx/dr_py/blob/main/js/LIBVIO.js) 使用 `www.libvio.app` 和发布页发现逻辑 | 当前订阅为 `.pw`，镜像为 `.cc`，未证实地址映射；`.cc` 已返回域名停用通知 |
| 瓜子 / `csp_AppgzGuard` | 快照 [瓜子[优].js](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/spider/js/%E7%93%9C%E5%AD%90%5B%E4%BC%98%5D.js)：正文为 Base64 文本，静态解码后是 `api.w32z7vtd.com` 的 `/App/IndexList/indexList`、`/App/Index/findMoreVod`、`/App/IndexPlay/playInfo`、`/App/Resource/VurlDetail/showOne` 请求，依赖 CryptoJS、forge、md5 | 已确认不是只有名称的空规则；未执行签名/鉴权请求，未证实和 Guard 相同接口。只读访问 API 根路径不能证明这些业务端点有效 |
| 海绵 / `csp_HmysGuard` | 在已检查的 drpy3 示例、CatPawOpen 视频目录、镜像 `spider/js` 与 `spider/js_dr2` 中未找到可明确对应规则 | 仅表示本次有界调查未找到，不表示全网不存在；仍缺具体实现和上游身份 |
| 玩偶 / `csp_WoGGGuard` | 快照 [玩偶哥哥[盘].js](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/spider/js/%E7%8E%A9%E5%81%B6%E5%93%A5%E5%93%A5%5B%E7%9B%98%5D.js)：`www.wogg.one`，`/vodshow/`、`/vodsearch/`、`.module-items .module-item`、`.module-row-title`，详情识别分享链接并委托网盘模块，播放方法读取下载/转码地址 | 这是具体的 WoGG 抓取与网盘播放实现，仍不能证明等价于 Guard、相同域名、4K或弹幕覆盖；本次首页证书验证失败，没有完成接口链路 |

厂长与旧 LIBVIO 规则来自 [hjdhnx/dr_py](https://github.com/hjdhnx/dr_py)，该仓库 main 最新提交时间核查为 `2024-05-30T10:21:03Z`，根 [许可证](https://github.com/hjdhnx/dr_py/blob/main/LICENSE)是 LGPLv3。它们是旧实现参考，不应当作近期维护保障。

## 玩偶哥哥的网盘能力：有实现，也有必须改造的行为

玩偶规则确实调用了 Quark、UC、Cloud、Ali 等具体对象，不只是返回分享链接。镜像 [pans.js](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/utils/pans.js)导出阿里、百度、天翼、123、夸克、UC、115、迅雷相关模块；模块存在不等于这些服务今天均可用，也不能把模块数量当网盘验收数量。

[夸克实现](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/utils/pan/quark.js)和 [UC 实现](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/utils/pan/uc.js)是可导入的 JavaScript 模块，依赖请求封装、ENV、Cookie 管理、加密和文件系统。它们有共享实例及缓存，因此嵌入多用户后端时必须明确账号与会话隔离，不能让不同用户复用全局 Cookie 和文件 ID 缓存。[天翼实现](https://github.com/Hululu007/drpy-node/blob/295f2b7047e14122d542a7736cb931e81abcf85c/utils/pan/cloud.js)依赖 ENV、Axios、qs 和加密库，并有 `getShareUrl`，不是靠一个通用网页解析器自动支持。

最重要的实际行为是网盘写入：WoGG 的夸克/UC 分支调用 `getDownload(..., true)`；夸克 `getDownload → save → createSaveDir` 会转存，保存目录处理还会调用 `file/delete` 清理既有文件。此默认行为必须先改成应用专属目录、明确所有权和清理范围，再进行真实账号验证，不能把“打开视频”描述成完全只读。

规则还拼接了 `127.0.0.1:5575` 和 `127.0.0.1:7777` 代理地址。这些分支依赖额外本地能力；手机浏览器的回环地址也不指向后端。为了兑现单服务，必须将所需代理能力改成当前后端路由，并验证 Range、Cookie、请求头、重定向和播放地址有效期；不能照搬字符串后宣称无需其他服务。规则返回的网盘 Cookie 也不应直接暴露给前端。

## 饭太硬原有三个 JS 入口

三个入口引用同一个 `drpy2.min.js`，各自 ext 指向 `fantaiying7/EXT` 的原始规则。本次以下原文件均可读取，没有执行：

| 入口 | 原始规则及静态证据 | 尚未验证 |
| --- | --- | --- |
| 虎牙js | [虎牙.js](https://github.com/fantaiying7/EXT/blob/main/%E8%99%8E%E7%89%99.js)，约 4.1 万字符，规则 host 为 `www.huya.com` | 原引擎全局对象、签名和直播地址解析在新宿主中的兼容性 |
| 斗鱼js | [斗鱼直播.js](https://github.com/fantaiying7/EXT/blob/main/%E6%96%97%E9%B1%BC%E7%9B%B4%E6%92%AD.js)，约 2.4 万字符，host 为 `m.douyu.com`，包含 `sniffer:1` | 仅执行规则是否够用；浏览器嗅探依赖如何处理 |
| dr_兔小贝 | [兔小贝.js](https://github.com/fantaiying7/EXT/blob/main/%E5%85%94%E5%B0%8F%E8%B4%9D.js)，约 1 千字符，host 为 `www.tuxiaobei.com`，播放解析通过 `fetch` 和 `jsp.pdfh` 读取 `video-src` | HTML 是否仍匹配、媒体 URL 是否有效及浏览器实际播放 |

这三项的源码引用关系比“同名替代 CSP”更确定，适合独立验证 drpy2 兼容层。仍不能把源码可读取计为三个站点已支持，尤其斗鱼显式声明嗅探。

## 只读 HTTP 抽样记录

2026-10-30 从当前开发环境发起普通 GET，无 Cookie、无登录、未执行返回脚本；每次最多读取约 512 KB，使用默认 TLS 校验。失败仅反映当前环境和请求方式，不能推断全球不可用。

| 地址 | 本次结果 | 可支持的判断 |
| --- | --- | --- |
| `https://www.wogg.one/` | TLS 证书链验证失败；未降低校验重试 | 当前环境未取得首页；未验证规则选择器 |
| `https://www.libvio.pw/` | HTTP 403 | 订阅地址存在访问限制；不能以此确定网站失效 |
| `https://www.libvio.cc/` | HTTP 200，标题为域名暂时停止使用通知，没有检查的影片列表标记 | 200 并不代表可用影视列表；镜像规则至少需要检查地址更新 |
| `https://www.czzy88.com/` | HTTP 200，跳转 `https://cz01.vip/`，标题为厂长资源官网；没有 `.bt_img` 标记 | 得到发布页，不是原规则期待的列表页 |
| `https://api.w32z7vtd.com/` | HTTP 200，约 74 字符的根路径响应 | 只证明 API 主机根路径有响应，未测试加密业务接口 |

## 对实现顺序的建议

1. 保持“单后端服务”和“站点逐项验收”两个约束。纯 Node 路线可作为适配器重实现方案，但不能把它描述成自动接管 45 个 Guard 的最低成本方案。
2. 若采用 Node，先用订阅直接引用的兔小贝规则验证引擎宿主，再做一个有明确当前域名的普通影视站点；搜索、详情、播放解析和真实播放必须分别记录证据。
3. 网盘单独用一个明确服务验收完整链路：登录/凭据、分享解析、转存范围、文件选择、播放代理、清理和失效处理。玩偶页面抓到网盘链接不算网盘播放通过。
4. 在站点域名映射和真实链路完成前，将厂长、立播、瓜子、玩偶记为“找到候选实现”，海绵记为“本次未找到”，不要生成虚假的支持百分比。
5. 与 Java 方案比较时，使用同一订阅快照和同一端到端验收集。语言不是决定标准；是否直接处理现有 Guard、是否需要额外常驻服务、网盘链路是否有效，以及长期规则维护成本才是关键。

本研究只建立复用可能性与阻塞证据，未修改应用代码，未形成运行、搜索或播放成功结论。
