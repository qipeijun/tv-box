# 饭太硬的 Java/JVM 后端路线：源码核验

研究日期：2026-10-30。范围为静态读取一手文档、源码与测试；没有运行远端插件、构建运行时、启动模拟器或进行真实播放。本文配合[网盘能力研究](2026-10-30-cloud-drive-options.md)阅读。

## 结论与路线

**Android 整机不是已知唯一方案。存在直接针对饭太硬 `ftyguard_v8.so` 的桌面 JVM 实现，可以成为本项目的验证起点。** 但“改成 Java”本身不解决 DEX、Android API、JNI、网盘登录和媒体代理；需要引入并维护完整兼容层。

最关键候选是 [jo32/tvbox-silicon](https://github.com/jo32/tvbox-silicon)，本次核验固定到 `6ce6f6e743e6bb21f11869fda9fdf195e691e16c`，提交时间 2026-10-29 22:39:04 +08:00。其 JavaHost 确有 FTY 原生加载链路，而非把 FTY 名称映射到另一个重写站点。作者已有运行报告，但当前项目的确切插件版本、网络和播放效果尚未独立复现。

| 路线 | 对用户的部署形态 | 能力与成本 | 当前判断 |
| --- | --- | --- | --- |
| 保留 Node 主后端，打包并自动管理 JavaHost worker | 一个发布包、一次启动、一个对外 HTTP 入口；内部 JVM 子进程和 loopback 代理由主服务管理 | 保留现有 JS/HTTP 能力；增加插件桥接、生命周期和媒体代理整合；原生崩溃较易在 worker 层回收 | **最小迁移候选，先做精确样本 PoC** |
| Java 主后端直接调用 `InProcessHost.request` | 可做一个 JVM 主进程；原样兼容层仍有内部 loopback HTTP 监听 | 无需 Swift 或单独 Android；需迁移 HTTP 契约及 JS3 宿主；插件线程/native 与业务共用故障域 | 若明确要求单 JVM，再比较整体迁移；不应先重写后验证 |
| Android 运行环境 | 可封装启动，但依赖 Android 运行环境及管理 | 对真正依赖 Android UI/WebView/系统服务的插件更完整，部署与资源成本更高 | 作为兼容层 PoC 失败或必须覆盖特定 Android 能力后的备选 |

用户要求“不想跑多个服务”，并不自动等于“禁止任何子进程”。第一条路线无需用户手工维护 Java API 服务，也无需另配 Android 服务。**一个对外入口不等于系统只有一个监听端口**；上游 JavaHost 内部媒体代理必须准确披露并接到现有 Web 后端。

## 为什么普通 Java 后端不能直接加载当前工件

标准 JVM 的类加载器加载 Java class 字节码。Android `DexClassLoader` 面向 DEX，且依赖 Android 运行时；扩展名同为 JAR 不能代表可直接在 JVM 执行。[Android DexClassLoader 文档](https://developer.android.com/reference/dalvik/system/DexClassLoader)

DEX 转 class 只解决字节码格式。插件若调用 `android.content.Context`、WebView、Android 系统服务或 JNI，仍需相应实现。Android ARM64 ELF 的 CPU 架构与宿主相同，也不等于可以直接 `System.load`；还涉及 Android ABI、系统库与 JNI 环境。[Android ABI 文档](https://developer.android.com/ndk/guides/abis)

当前主任务已静态记录的 FTY JAR SHA-256 为 `898e9d7e787c01c2f24ff2457de08533f6b81b165a18103768e1898ba935693c`，含 76 个 DEX 类，v8 ELF 依赖 `liblog/libandroid/libc/libm/libdl`。这些形态与候选加载器处理的目标接近，但**不能由此推出当前版本已可用**。

## 候选 JavaHost 实际做了什么

以下链接均固定到本次核验提交，避免默认分支后来改变造成证据漂移。

| 源码 | 核实到的行为 | 对方案的意义 |
| --- | --- | --- |
| [ProcessHost.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/ProcessHost.java) | 独立 Java main 读取 stdin JSON，调用 `InProcessHost.request`，以原子响应文件回传；stdout 转 stderr；stdin 关闭后 `Runtime.halt(0)` | 可以被现有后端自动管理；不能把这个 main 直接嵌入业务 JVM |
| [InProcessHost.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/InProcessHost.java) | 公开 `request(String)`、`closeAll()`，组织 classloader、运行时池、请求取消与回收；FTY guard 工件按来源建立独立运行时 | 纯 Java API 可以作为同 JVM 整合起点；不存在必须调用 Swift NativeRuntimeBridge 才能工作的前提 |
| [NativeProbe.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/NativeProbe.java) | 识别 FTY guard；构建 unidbg AndroidResolver/API23 与 JNI 对象；调用 `.so` 的 JNI_OnLoad、`native_ting_md5`、`getLoader`；通过 DexNative 获取真实 Spider 并 init | 是实际 FTY native loader 适配；不是普通 Spring controller，也不是仅“支持 JAR”声明 |
| [HeadlessAndroidEmulator.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/HeadlessAndroidEmulator.java) | 默认 unidbg AndroidARM64Emulator + Unicorn2；`tvbox.apple` 才选 Apple 专用解释器 | 桌面路线不必使用 iOS/tvOS 定制 JVM、Swift 嵌入桥或整机 Android 模拟器；仍需要原生模拟库 |
| [DexClassLoader.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/dalvik/system/DexClassLoader.java) | 自己实现同名 Android 类，在 URLClassLoader 上转换 DEX，结合惰性转换与内容缓存 | 不是标准 JVM 原生支持 Android DEX |
| [BytecodeCompatibility.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/BytecodeCompatibility.java) | 改写 native 调用、System.load、代理调用及字节码兼容问题，并含特定站点兼容逻辑 | dex2jar 之外仍有大量宿主适配，需跟随插件版本维护 |
| [AndroidNativeRuntime.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/AndroidNativeRuntime.java) | 用 unidbg 映射 Java/JNI 与 Android native，非宿主直接 dlopen Android ELF；部分 JNI 类型尚有限制 | native 兼容能力有边界，不代表完整 Android |
| [PluginSession.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/PluginSession.java) | 调用首页、分类、搜索、详情、playerContent，配合来源会话及媒体代理 | 覆盖本项目需要的主要 CatVod 调用链，但要映射已有 HTTP 契约 |

### 版本绑定与确切工件

[NativeLibraries.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/NativeLibraries.java)检查 ARM64 ELF 头、库体积及可选资产 `.md5` 内的 `arm64-v8a` 值。它没有观察到固定整包 FTY SHA/MD5 的白名单。

FTY 路径识别 `assets/ftyguard_v8.so` 或 `assets/ftyguard-v8.so`，调用已知 `DexNative` JNI 方法和 Spider 契约。文件名、类结构、方法签名、native 行为和 Android stub 覆盖范围仍是版本耦合点。没有固定 checksum 不等于所有 FTY 版本都兼容，资产附带 MD5 也不是来源可信签名。本次没有找到上游真实播放报告所用 JAR 的 SHA-256 与本项目上述 SHA-256 相等的证据。

### 构建、平台与运行依赖

[pom.xml](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/pom.xml)设置 Java release17；依赖 unidbg-android/unidbg-unicorn2 0.9.8、dex-translator 2.4.37、Android API stub、OkHttp、Gson、BouncyCastle、jsoup 等。[build-java-host.sh](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Scripts/build-java-host.sh)默认在 macOS 寻找 JDK19，用 Maven 构建并复制依赖、抽取所需 AAR classes.jar，使用 jlink 打包运行时。Android SDK/模拟器并非这条桌面宿主脚本的运行前提。

本次已知源码和作者报告主要支持 macOS/Apple 目标。**没有完成 Linux x86_64、Linux ARM64 或本项目部署机上的构建、native 后端可用性、性能验证**；Java 源码可编译不等于原生依赖跨平台已通过。选择服务器镜像前必须在实际目标平台验证。

[PluginProcess.swift](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Sources/TVCore/PluginProcess.swift)展示应用懒启动一个长期 JVM worker，自动管理停止/重启、请求文件和缓存。该层承担进程管理而非 FTY 的核心运算。移植 Node worker 管理器是有源码依据的工程推论，当前仓库尚未实现它。

### 内部媒体 HTTP 监听不能遗漏

[CloudDriveBridge.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Runtime/JavaHost/src/main/java/tvbox/runtime/CloudDriveBridge.java)构造时在 `127.0.0.1` 随机端口启动 HttpServer；另扫描 9978–9999 启动 `/proxy`，供插件 `do=ck` 探测及本地代理。随机代理有 capability 路径；两类处理器均拒绝带 Origin 的请求。

因此，管理协议的 stdin/文件方式不意味着没有 HTTP 监听。外部浏览器不能直接拿服务器 `127.0.0.1` URL 播放：那个地址指向浏览器所在设备。建议由本项目唯一对外媒体路由转发这些内部地址，并处理播放列表中的嵌套地址、Range、HEAD、上游请求头和失效续签。**这是需要新增并验收的 Web 适配，不是上游原样提取已经提供的结果。** 不必为了一个对外端口立即重写所有内部代理。

### 类加载隔离不是 native 硬隔离

`InProcessHost` 使用独立 URLClassLoader、busy/retired 集合和取消时间。源码明确：不会结束的请求对应运行时先退出服务，等请求真正返回后才 close。`close()` 与请求取消不等于能终止任意 native 循环或回收所有 JNI/进程全局状态。

单 JVM 方案需要测量 native 内存、线程、classloader 留存、取消后资源回收以及崩溃影响。worker 方案可以在最后期限后杀掉并重建 worker，但会中断该 worker 的其他请求和活跃媒体会话；不能只写一个超时参数就宣称完成隔离。生产限制、缓存恢复和并发上限须由 PoC 数据决定。

## 证据强度：源码、测试、作者报告不可混为一谈

| 证据 | 实际能证明什么 | 不能证明什么 |
| --- | --- | --- |
| NativeProbe 的 FTY 分支 | 存在针对 FTY guard 的真实实现 | 本项目当前 SHA 工件必然运行成功 |
| [NativeLibrariesTest.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Tests/Java/NativeLibrariesTest.java) | 合成 ELF 头用于检查发现/ABI/MD5 逻辑 | 测试并未执行真实 FTY `.so` |
| [PluginLoadingTest.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Tests/Java/PluginLoadingTest.java) | 编译 PlainFixture，验证独立 CLI 与纯 Java InProcessHost 入口 | fixture 没有 FTY guard；不证明真实站点网络或播放 |
| [CloudDriveBridgeTest.java](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Tests/Java/CloudDriveBridgeTest.java) | 合成凭据和响应下的桥接逻辑 | 不证明真实扫码、权限、会员清晰度、签名时效或媒体字节 |
| [on-device-runtime-status.md](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Docs/on-device-runtime-status.md) | 作者记录 2026-10-13 Apple TV FTY 夸克 4K、10-14 百度扫码后解析；说明路线有超出 mock 的上游使用报告 | 原始现场证据主要在未提交构建目录；本次未独立复现，更非当前服务器性能/全源兼容承诺 |

同一状态文档记录过 Guazi 首次 DEX 转换和初始化达数分钟、显著内存峰值及缓存后改善；这是特定历史插件、设备和实现版本的数据，**不得当成本项目未来 SLA**。它足以说明冷启动和缓存是必测项。

[check-java-host.sh](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Scripts/check-java-host.sh)备注过 2026 年 10 月旧 host-v13 缓存打包导致玩偶哥哥与 2026-10-21 FTY 空结果；字节码兼容版本必须跟随升级。Android UI、完整 WebView 嗅探、依赖外部 Go 子进程等能力仍不能因采用该宿主而自动获得。

## 许可、可提取程度及其他候选

上游 [第三方声明](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Docs/THIRD_PARTY_NOTICES.md)明确原创代码为 **GPL-3.0-only**；FTY 特定适配及字节码改写不是无许可证片段。unidbg、dex2jar 为 Apache-2.0，Unicorn 为 GPL-2.0，随包 JRE 有自己的许可及 notices。复制或修改 JavaHost 应按其适用许可处理；不把 Apache-2.0 的 unidbg 许可证误套给整个宿主。

[runtime-extraction-plan.md](https://github.com/jo32/tvbox-silicon/blob/6ce6f6e743e6bb21f11869fda9fdf195e691e16c/Docs/runtime-extraction-plan.md)在 2026-10-15 标为 **future work, not started**：通用 Android runtime 与 CatVod/FTY/网盘逻辑仍交织，公开 API 与性能未稳定；依赖许可组合也列为需确认的问题。因此可以提取 JavaHost 做原型，但不能称为已经发布、稳定、可直接加一个 Maven 依赖的通用 SDK。

| 项目 | 核实结果 | 对本任务价值 |
| --- | --- | --- |
| [jo32/tvbox-silicon](https://github.com/jo32/tvbox-silicon) | 本文已固定提交深入核验；GPL-3.0-only 的 JavaHost + unidbg + 转换层；作者报告真实 FTY 播放 | 当前最贴近目标的直接验证起点 |
| [zhkl0228/unidbg](https://github.com/zhkl0228/unidbg) | 官方 README 定位为 Android/iOS native 模拟，提供 JNI、ARM32/64、syscall 与后端；Apache-2.0 | 可运行部分 Android native 逻辑，但不是完整 Android，也不是现成 CatVod/FTY 服务；独立从零接入需要补 JNI/上下文/加载器 |
| [power721/alist-tvbox](https://github.com/power721/alist-tvbox) | 真实 Java/Spring 后端，有 jar/Docker 部署、AList 网盘聚合和 TVBox API；本次只读 README/pom | 证明 Java 网盘/TVBox API 服务可做；不能由项目名称推出它支持执行任意 FTY Android JAR。未将其列为 FTY 运行替代 |

[Enjarify 官方说明](https://github.com/Storyyeller/enjarify)与 [dex2jar 源码](https://github.com/ThexXTURBOXx/dex2jar)支持的是字节码转换层；它们不会单独补出 Context、WebView、Android native 库与 JNI。仅“先 dex2jar，再 URLClassLoader”不足以覆盖本次工件。unidbg 是真实可行的底层组件，但本案可行性证据来自完整 JavaHost 的组合实现，而非 unidbg README 一句话。

## 最小验证门槛

先做隔离的兼容性原型，保持现有接口和前端。通过后再决定 Node 主服务加 worker，或 Java 主后端；不先迁移全部后端以换取尚未证实的兼容性。

1. **固定输入与运行环境**：固定上述 FTY SHA、订阅配置与 ext；固定上游提交、宿主版本和实际部署平台。只记录必要哈希与诊断，不记录账号凭据。
2. **证明真实加载链**：在没有 Android 整机的目标机器上，完成实际 guard 初始化、DexNative.getSpider、Spider.init；失败要区分缺失 JNI/API、转换错误、版本差异与网络错误。
3. **证明业务调用**：选择当前订阅内至少三个不同类型来源，包括普通影视与 FTY 网盘路径；验证首页/分类/搜索/详情/选集/playerContent，返回真实数据而非 fixture。单个源成功不升级成全订阅通过。
4. **证明 Web 媒体链**：完成真实网盘登录、恢复与退出；经本项目主后端代理实际取得媒体字节，验证 Range/HEAD、播放列表嵌套 URL、拖动和一条受保护清晰度路径。播放器可播需之后独立浏览器授权与验证。
5. **证明资源边界**：冷/热启动、缓存更新、并发搜索与播放、网络断开、过期登录、超时取消、卡死回收、worker重启后恢复；测量堆内/堆外内存和仍存活线程。单 JVM 方案另验 native 崩溃的业务影响。
6. **证明交付形态**：一个发布包、一次启动/停止、一个对外入口；主服务负责 worker 与内部代理生命周期，不要求用户另启动/配置 Java HTTP 服务。明确所需 JRE/native 包与目标平台。

PoC 成功的口径是“固定版本、固定来源与账号场景通过”，而不是“所有协议都支持”。若核心 FTY guard 初始化即失败，先评估缺口是否局部可补；若涉及大量 Android UI/系统能力或持续版本逆向成本超出预算，再转 Android 方案或收窄来源范围。

## 本次完成与未完成

已完成：一手资料检索；指定提交的 JavaHost、Swift 进程宿主、构建脚本、测试、许可与运行报告静态核验；明确可提取入口、内部代理监听及真实测试边界。

未完成：编译、依赖安装、当前 FTY 工件执行、部署平台验证、真实账号登录、媒体取得及浏览器播放。没有改业务代码或执行订阅中的 JAR/JS。
