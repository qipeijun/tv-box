# 饭太硬运行方案：静态可行性核对

日期：2026-10-30。本文保留初步静态调查。后续已发现专门的 Java 饭太硬兼容层，技术推荐已由 [完整后端调研](../research/2026-10-30-backend-recommendation.md)更新。用户拒绝多个独立维护的服务，但未锁定 Node 或单操作系统进程；不能将本文早期候选判断作为最终选型。

以下 Android 依赖证据仍用于说明原工件不能直接作为普通 Node/JVM 模块加载，不用于推导“观看这些资源必须部署 Android”。尚无本项目的饭太硬站点调用或真实播放成功证据。

## 已查明

- 当前公开订阅的 48 个站点全部为 type: 3，其中 45 个 csp_ 入口、3 个 drpy2 JavaScript 入口。见 [订阅探测](fantaiying-compatibility-probe-2026-10-30.json)。
- 顶层 Spider 工件实际为含 classes.dex 的 ZIP，包含两个原生 .so 文件及 Android 类引用，没有普通 JVM .class 文件。工件 MD5 与订阅声明一致；这只校验版本一致性，不证明代码可信或可执行。见 [工件静态检查](fantaiying-spider-static-2026-10-30.json)。
- 当前主机为 macOS arm64，具备 Java 17、Android SDK、Android Emulator、arm64 系统镜像和一个已有 AVD。仅检查安装目录与配置，未启动模拟器、连接设备、安装应用或执行第三方工件；已有 AVD 不作为本任务专用运行环境。

## 一手实现依据

- [Box JarLoader 源码](https://raw.githubusercontent.com/takagen99/Box/main/app/src/main/java/com/github/catvod/crawler/JarLoader.java)：通过 Android DexClassLoader 加载工件，将 csp_ 映射为 Spider 类，以 Android Context 和 ext 初始化，另外保留 Spider 代理入口。这是宿主能力的参考，不证明饭太硬当前工件适配该版本。
- [FongMi 爬虫介接](https://fongmi.github.io/TV/spider/)：站点详情的播放标识经 playerContent 转为实际地址，并有独立代理与脚本宿主契约。其 Node.js、QuickJS 和 Java 路径是不同宿主，不能互相视为同一种执行能力。
- [drpy3 项目](https://github.com/hjdhnx/drpy3)：提供 drpy2 兼容层与宿主注入接口，可作为当前三个 JavaScript 规则入口的候选验证路径；不能据此宣称支持 Android 工件或饭太硬实际规则。

## 方案取舍

| 方案 | 与当前证据的关系 | 需要验证的代价 |
| --- | --- | --- |
| 现有电脑上的专用 Android 宿主，经固定桥接接口供后端调用 | 与 Dex、Android 类及原生依赖相符，但不符合用户本轮单服务约束 | 工件与宿主实际兼容、ABI、初始化、代理、后台存活和资源占用；额外维护运行环境 |
| 普通 JVM 或纯 Node 直接加载该工件 | 不能直接处理已发现的 Android Dex 与原生依赖 | 不能当作快捷实现路径；任何兼容层都必须另有真实执行证据 |
| 将站点逻辑逐站移植为服务端适配器 | 可独立支持特定站点，不等于执行原饭太硬工件 | 需取得真实接口契约并维护站点变化，少量移植不能宣称整份订阅兼容 |

当前优先验证可嵌入 Node 的 JavaScript 规则与同站点适配器，网盘与媒体代理作为同一后端模块。已核实 drpy3 宿主指南提供 ESM 装载、Node 参考宿主、播放解析和代理契约；这只证明存在可嵌入的 JS 路线，不证明饭太硬的 Guard 工件或其站点已经兼容。drpy2 老规则还需要同步请求语义，需避免阻塞现有服务；具体执行方式由原型确认。

参考：[drpy3 宿主对接指南](https://github.com/hjdhnx/drpy3/blob/main/docs/宿主对接指南.md)。不能把执行层换成 Python/Go 或把 Dex 转成 Java 字节码视为已解决 Android 原生依赖。

## 单后端候选的具体边界

- drpy3 的 [包定义](https://github.com/hjdhnx/drpy3/blob/main/package.json) 提供 ESM 库入口，所需宿主能力可在现有后端接线，无需另开 HTTP 服务。项目 Node 版本约束与本仓既有 Node 26 验证记录不一致，必须先验证版本兼容；其 JS 兼容层不是 Dex 加载器。
- [CatPawOpen](https://github.com/CatPawApp/CatPawOpen) 提供 Node/Fastify 站点插件示例，[路由注册](https://github.com/CatPawApp/CatPawOpen/blob/main/nodejs/src/router.js) 直接导入并注册插件。可作为同站点适配参考，不照搬其独立服务启动入口。需核对许可证、Fastify 4/5 差异及配置、存储、模块状态依赖，不能假设直接复制即可多订阅并发使用。
- 该项目的 AList 插件依赖已有 AList 服务，不能拿它证明单后端已具备网盘直连登录与播放；本轮网盘路线仍需验证实际平台契约。
- 本次原 hjdhnx/drpy-node 与 catvod/CatVodOpen 地址返回 404，不以旧摘要作为当前可安装能力的依据。

以上只确认存在可嵌入实现的候选，不确认饭太硬具体站点可用，也不将其他源的影片当作饭太硬覆盖。

## 首个验证切片

使用饭太硬真实配置与可核实的同站点规则或接口，从普通影视站点的分类或搜索得到真实影片，再取得详情和播放解析结果；同时核对请求头、站点代理和播放标识契约。若未找到可用服务端实现，应如实记录覆盖缺口，不能通过重命名其他来源完成验收；取得 URL 也不能记为网页播放完成。

运行器桥接必须保留来源与配置版本，响应可取消且有超时；普通 CMS 继续沿用现有路径。先确定这条路径可行，再将普通影视站点、JavaScript 站点和网盘平台拆成可独立验收的实现任务。

## 当前验证边界

本次只有公开配置读取、工件静态检查、本机安装条件检查和一手源码查阅。没有运行测试、构建、浏览器、模拟器或第三方 Spider；没有取得账号凭据，也没有修改应用源码或部署。
