# 单部署网盘登录与播放路线调研

调研日期：2026-10-30。范围：家庭后端每个平台保存一份共享登录；用户只维护一套应用部署。未假定夸克、UC、阿里、115 全部属于首期范围。本文仅静态阅读一手源码和作者文档，没有登录网盘、使用用户凭据、执行第三方插件、启动服务或验证真实播放。

## 判断

网盘登录、令牌刷新、分享转存、下载地址解析及 HTTP Range 转发，本身不受 Node/Java 语言限制。**不需要为了这些 HTTP 能力运行 Android。** 饭太硬的额外困难是插件宿主兼容和插件内部账号格式；换语言不能自动解决，但已找到桌面 JVM 处理饭太硬账号和媒体的具体开源实现，值得优先做小范围 POC。

建议将账号管理、来源插件和媒体代理放在同一套应用内。若选择 Java 插件宿主，可由主应用管理它的内部进程和回环接口，不要求用户额外配置 Android、AList 或独立网盘服务。不要为了网盘适配单独重写现有后端；是否整体迁移 Java，应由饭太硬运行及播放 POC 决定。

## 候选项目与证据等级

| 项目 | 可借鉴/复用的部分 | 登录方式与依赖 | 边界与许可证 |
| --- | --- | --- | --- |
| [jo32/tvbox-silicon](https://github.com/jo32/tvbox-silicon) | Java `CloudDriveBridge`、账号注入、插件媒体探测；Swift HTTP 扫码流程 | 夸克/UC 扫码与网页登录；百度/阿里扫码；手工凭据。无需另跑网盘服务 | 最贴近饭太硬；整体是 Apple 原生播放器，不能直接当 Web 后端。GPL-3.0；部分代码需移植、宿主需独立验证 |
| [iGwkang/gopeed-extension-quark](https://github.com/iGwkang/gopeed-extension-quark) | 模块化 JavaScript 夸克分享、转存、取直链、过期刷新 | 手工 Cookie，不支持扫码；运行版本依赖 Gopeed 事件/设置/存储 API | MIT；可抽出 HTTP 核心接 Node，不是直接可用的后端 SDK。作者的真实账号验收清单仍未完成 |
| [OpenListTeam/OpenList](https://github.com/OpenListTeam/OpenList) | Go 网盘适配、账号保存、下载链接和代理实现参照 | 夸克/UC Cookie；阿里/115 OAuth token；部分驱动默认依赖项目在线令牌服务 | AGPL-3.0；可独立作为一套 Go 存储服务，但不自动接入影视站点、不执行饭太硬。不能用额外部署 OpenList 来代替本任务的单部署要求 |

源码取证版本：tvbox-silicon `6ce6f6e743e6bb21f11869fda9fdf195e691e16c`；Gopeed 扩展 `d99ecb4bac479b77af6300a551119a0b3ec947f3`；OpenList `78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02`。后两者读取 main 源码归档并同次核对 HEAD；未执行仓库代码。

## 1. tvbox-silicon：最接近饭太硬实际链路

### 登录和插件注入

[`CloudDriveQRLogin.swift`](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Sources/TVCore/CloudDriveQRLogin.swift) 通过 HTTP 获取二维码、轮询授权、兑换 Cookie/token。夸克在扫码完成后还获取 mobile service ticket；UC 走对应账号接口；百度取得 BDUSS/STOKEN；阿里解析扫码结果内的 refresh token。这证明流程无需 Android UI，但这些第三方私有接口的持续可用性仍需真实账号确认。

[`CloudDriveBridge.java`](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/CloudDriveBridge.java) 的 `restoreFtyQuarkAccount` 同时需要 web Cookie 和 mobile ticket。仅存 Cookie 不等于饭太硬已登录。它使用 ASM 按结构识别混淆后的账号类，再写入相应字段；这是版本相关的兼容维护，不是一个稳定官方插件接口。百度/阿里另有插件账户文件同步。

[`CloudDriveAccounts.swift`](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Sources/TVCore/CloudDriveAccounts.swift) 将凭据独立持久化，目录/文件权限为 0700/0600，生成账号修订值以重建插件会话。[账号页面](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/App/CloudDriveView.swift) 退出时同时清除应用账户、插件登录文件并重载会话。家庭后端应采用相同的完整生命周期，不能只删除数据库 Cookie 而保留旧 worker 登录态。

[`OwnDriveSignIn.java`](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/OwnDriveSignIn.java) 还有调用王二小/Wex 插件配置中心 `loginStart/loginPoll` 的机制。这不是任意饭太硬源或 115 的通用登录 API；不可据此宣称饭太硬全部网盘已覆盖。

### 播放和 Range

Java bridge 既能 relay 插件流，也可请求两字节 Range 捕获真正 CDN URL、必要请求头和长度，交给播放器直连。它要求有效 `206/Content-Range`，必要时用文件中部范围再次探测。内部 HTTP 服务仅监听回环并使用随机能力路径；这类内部端口不等于用户需要维护多个服务。

作者在[开发文档](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Docs/DEVELOPMENT.md) 报告 2026-10-13 实机 Apple TV 饭太硬夸克 4K 播放，并指出旧插件代理会大量建线程及停顿，提取 CDN URL 后得到改善。**这是上游作者的设备/网络/账户实测，不是本项目独立验证。** 同一文档中的合成凭据 WoGG 初始化测试仅证明配置传入，不能证明真实登录或视频播放。

Web 前端与原生播放器不同：需要 Cookie/Referer/UA 的视频不能假定浏览器 `<video>` 能直接附加请求头，CDN 也未必允许跨域。应由同一后端的受控媒体入口添加上游头、转发 Range、在客户端断开时取消上游流；不把完整网盘 Cookie 返回浏览器。CDN 提取优化可用于后端直接拉取，不能原样照搬为前端直连。

## 2. MIT JavaScript 夸克模块：独立网盘适配的候选

[`api.js`](https://github.com/iGwkang/gopeed-extension-quark/blob/d99ecb4bac479b77af6300a551119a0b3ec947f3/src/quark/api.js) 提供分享 token、分享目录、转存任务、任务轮询、下载地址、建目录和删除 API。`createQuarkApi(request)` 可注入 HTTP 实现；因此 HTTP 核心比完整 Gopeed 应用容易移入 Node。

[`transfer.js`](https://github.com/iGwkang/gopeed-extension-quark/blob/d99ecb4bac479b77af6300a551119a0b3ec947f3/src/quark/transfer.js) 明确采用“分享到自己的临时目录 → 取直链 → 可选删除”的顺序，按可用空间分批；自己的网盘文件无需这一步。此路径存在云端写入和容量要求，不能在产品上描述成完全只读解析，也不能把该要求推论为所有网盘/所有播放 API 都必须转存。

[`start.js`](https://github.com/iGwkang/gopeed-extension-quark/blob/d99ecb4bac479b77af6300a551119a0b3ec947f3/src/quark/start.js) 用 `Range: bytes=0-0` 探测链接、按到期时间刷新；旧转存文件不存在时重新转存。它不是 Web 流代理，也不提供转码。迁入后还需替换 Gopeed 存储/设置/事件、补扫码流程和媒体生命周期；不应照搬下载任务的“拿到地址立刻删除”策略来承诺长期播放稳定。

其[手工验收文档](https://github.com/iGwkang/gopeed-extension-quark/blob/d99ecb4bac479b77af6300a551119a0b3ec947f3/docs/manual-acceptance.md) 明确写着等待用户用真实 Cookie 验证；自动化测试不证明真实平台当前可用。适合作为小范围 Node 自有适配的起点，不足以替代饭太硬插件运行，更不等于全网盘 SDK。

## 3. OpenList：多网盘限制的源码参照

[`quark_uc/util.go`](https://github.com/OpenListTeam/OpenList/blob/78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02/drivers/quark_uc/util.go) 的下载链接携带 Cookie、Referer、UA，并更新响应中的 `__puus`。夸克转码路线调用平台 `/file/v2/play/project` 获取现成视频地址，**不是后端本地转码**。`Concurrency: 3` 和 10 MB 分块是该实现的设置，不是平台保证三人同时播放。其[夸克文档](https://doc.oplist.org/guide/drivers/quark) 还标明旧逆向驱动不再积极维护，并说明速度与会员/代理条件相关；不宜承诺免会员 4K。

[`aliyundrive_open/meta.go`](https://github.com/OpenListTeam/OpenList/blob/78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02/drivers/aliyundrive_open/meta.go) 默认开启在线 API，令牌更新地址为项目服务，同时允许配置自己的 client ID/secret。故“一个自行部署的应用”与“不依赖第三方令牌代理”是两件事。[驱动文档](https://doc.oplist.org/guide/drivers/aliyundrive_open) 解释 OAuth token 归属；它与饭太硬消费的阿里私有 refresh token 不能随意互换。

[`aliyundrive_open/callback.go`](https://github.com/OpenListTeam/OpenList/blob/78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02/drivers/aliyundrive_open/callback.go) 按同一账号限制代理下载并发，默认 1，响应流关闭才释放额度；仅对 HTTP 403 且同时含 `RequestDeniedByCallback/ExceedMaxConcurrency` 的错误执行有界重试。这个源码证据说明家庭共享账户也要考虑平台并发，不能把应用 worker 数当作可播放设备数。

[`115_open/meta.go`](https://github.com/OpenListTeam/OpenList/blob/78c5d9b60b8c1d6a450346b4f6a7c30059ccbe02/drivers/115_open/meta.go) 要求 access/refresh token，默认 API 限速每秒 1 次，下载缓存区分 UA。这只证明具体驱动的策略，不证明饭太硬需要 115、不证明 115 的固定会员门槛，也不证明任意两台设备能同时播放。

OpenList 驱动依赖框架内部状态/持久化包，不是可直接引入 Node/Java 的 SDK。整体迁移 Go 仍需重写业务 API、影视站点/订阅适配与饭太硬宿主，不能把存储浏览能力当作完整影视后端。当前更适合参考行为及错误处理。

另核查 CatPawOpen 的 Node pan 目录，仅见 AList HTTP 适配；未找到内置完整夸克/UC/阿里账号管理，且源码归档未见许可证文件。它不能作为已验证的单部署多网盘解决方案。

## 最小 POC 与迁移代价

按饭太硬当前实际解析出的网盘来源确定首期范围，优先选择一条已存在的夸克来源贯通，不先扩展所有平台。POC 应有以下验收证据：

1. 固定订阅、插件版本和源标识，完成搜索、详情、选集，得到真实网盘播放候选；“导入成功”不算通过。
2. Web 发起扫码，后端完成授权并保存必要的 Cookie/ticket；重启后可用、过期可重登、退出可清掉 worker 内登录。账号秘密不进入前端响应或日志。
3. 经同一公共后端地址实际播放至少一集，验证 `HEAD`、有效/无效 Range、拖动、暂停后恢复、链接到期刷新和浏览器断开；记录所用浏览器和编码，不用拿到直链代替播放成功。
4. 若路径需要转存，先核对应用专用目录及容量，仅清理本应用创建的文件；两台设备同时播放时不得互删，明确计费/会员、容量及风控错误。
5. 使用共享账号分别检查单播、两路同时播放和退出重登；测账号限流/占用释放，不把默认线程数当作平台能力。真实测试需后续在用户认可的账户和可用资源上完成。

代价比较：保留 Node 自写 HTTP 适配的业务迁移最小，但每个平台认证、转存、签名、失效策略都由项目持续维护，且仍不能执行饭太硬 JAR。复用 Java bridge 能复用最贴近饭太硬的账号/媒体实现，但要移植 Swift 登录流程、对接 Web 播放和当前存储/业务契约，并承担 GPL 代码复用及混淆插件版本维护。全量迁移 Java 或 Go 都不是网盘 HTTP 功能的必要条件；只有 JVM 路线 POC 证明明显降低长期维护成本后，才值得决定整体后端迁移。
