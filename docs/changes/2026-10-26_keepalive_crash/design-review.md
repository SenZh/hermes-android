# 设计审查（Phase 1 门禁）

## 一、主 Agent 自审

### 1.1 产物齐全性检查

| 阶段步骤 | 必须产出 | 实际文件 | 状态 |
|---------|---------|---------|------|
| 需求分析 | 用户原始需求全文 + 可量化实现目标 | `requirements.md` | ✅ 用户原文（含完整堆栈）已收录；G1-G5 五条目标均可证伪 |
| 认知校准 | 事实清单 + 推断清单（推断绑定事实） | `analysis.md` 第一、二节 | ✅ 11 条事实均带文件行号或官方文档出处；4 条推断均绑定事实编号并标注置信度 |
| 分析 | 现状与目标差距 + 方案对比表 + 风险 + 根因 + 置信度 | `analysis.md` 第三至六节 | ✅ 方案对比含 A/B/C 三案，各有推荐/不选理由 |
| 环节证明 | 可行性证明矩阵（假设清零） | `tech-design.md` 第一节 | ✅ P1-P8 每项均列出隐性假设、证明手段、证据来源、备选预案 |
| 设计 | 技术方案 + 测试方案 + 产出契约 | `tech-design.md` / `test-plan.md` / `contract.md` | ✅ 三件齐全 |
| 设计审查 | 本文档 | `design-review.md` | 进行中 |

### 1.2 自审发现的自身问题（先行自查，不等 sub-agent）

| # | 自查项 | 结论 |
|---|-------|------|
| S1 | P1 声称"`appContext.reactContext` 在 `start()` 时已可用" | 证据成立：`HermesKeepAliveModule.kt:11-12` 的 `context` getter 本身就以 `requireNotNull(appContext.reactContext)` 为前提，且 `start()` 已被现有代码成功调用过（否则保活功能根本不会工作，而用户实际见过通知栏）。属**事实而非假设**，矩阵标记恰当。 |
| S2 | P3 声称"主线程 Handler 可行"，但未证明 4 秒窗口在主线程被 JS 阻塞时仍有效 | **这条自审不过关**。若主线程被 RN bridge 长时间占用，看门狗会与 `onStartCommand` 一起迟到，此时 4 秒窗口失去意义。矩阵里写了"等价于窗口后移"，但没给出证据。需在设计中明确：看门狗的目标是**消除悬空记账**，不是保证 4 秒硬实时；主线程阻塞场景由 P1（首行 startForeground）兜底。 |
| S3 | contract.md 的 C1"方法体第一条可执行语句即为 startForeground"，但设计中 `val title = intent?.getStringExtra(...)` 在它之前 | **契约与设计不一致**。取 extra 是纯内存操作，不构成风险，但契约措辞过严会导致静态断言难写。需把 C1 改为"方法体内 `startForeground` 之前不得出现 `ensureChannel` / `build` 之外的调用"，或在实现时把取值也挪进 try。 |
| S4 | B1 声称 `startForeground` 抛异常时"进程不崩" | **不成立**。catch 后仍调用 `stopSelf()`，而 `stopService`/`stopSelf` 先于 `startForeground` 已经被社区证明确实会触发同一异常（analysis.md F11）。这条需要在设计中承认"最后手段仍可能崩，但概率极低"，并说明为何可接受，不能写成"不崩"。 |
| S5 | test-plan.md 主动放弃 Kotlin JVM 测试 | 取舍合理（仓库无该测试源集，新增属于独立工程改造），但必须在交付时如实标注"Kotlin 行为未经自动化验证"，不得写成已覆盖。已在 test-plan 第三节写明。 |

**自审结论**：产物齐全，但 S2/S3/S4 三项是设计自身的实质缺陷，必须在设计审查裁决前完成修订，否则设计审查即使通过也是空的。

## 二、Sub-agent 独立审查

> 审查人：独立 sub-agent（未参与本次分析与设计撰写）
> 审查对象：`requirements.md` / `analysis.md` / `tech-design.md` / `test-plan.md` / `contract.md`
> 交叉核对基准（全部实读，非引用文档自述）：
> `KeepAliveService.kt`(118 行) / `HermesKeepAliveModule.kt`(60 行) / 模块 `AndroidManifest.xml`(12 行) / `TurnEffects.tsx:73-119` / `modules/hermes-keepalive/index.ts` / `modules/hermes-keepalive/android/build.gradle` / `scripts/verify-fixes.mjs`(Test 20-22) / `tests/*.test.ts` 用例实数 / `git log`（模块与崩溃版本的时间关系）

### 2.0 先行确认（这些项确实没问题，说明理由）

不先写出成立的部分，后面的否定就不可信。

- **F1-F10 的源码引用逐条对得上**。`ensureChannel`/`build` 在 try 外（`KeepAliveService.kt:29-33`）、catch 内 `stopSelf`（`:34-39`）、`start()` 只投递不等回执（`HermesKeepAliveModule.kt:28-41`）、`stop()` 与 `OnDestroy` 直调 `stopService`（`:52-58`）、`sync()` 的订阅源与降级分支（`TurnEffects.tsx:82-110`）、权限与 `foregroundServiceType="dataSync"`（模块 `AndroidManifest.xml:2-10`）、`onTimeout` 双签名（`KeepAliveService.kt:52-60`）—— 全部与当前工作区代码一致，无一条编造。
- **F10 的归因方向正确**，并且是本次分析最有价值的一条：异常由 `ActivityThread.generateForegroundServiceDidNotStartInTimeException` 产生、经 `ActivityThread$H.handleMessage` 投递，说明这是 AMS 侧的违约判定，不是 App 自己 throw。后续据此推翻 P3 的"窗口后移"论断，靠的就是这一条。
- **引用行号代表的就是崩溃版本的代码**。崩溃版本 `1.8.3-preview.16`（提交 `115fac7`，2026-10-26 12:57），模块源码最后一次变更是 `090fd38`（2026-10-07 19:53），`TurnEffects.tsx` 最后变更是 `b080cad`（早于 .16）。即崩溃时的字节码与本次引用的源码同源，不存在"引用的是改后代码"的错位。
- **方案大方向（投递后首行无条件 `startForeground`、投递前做前置校验、JS 侧消除裂脑）是对的**，驳回的是其证明过程与残留缺口，不是方向。
- **诚实性达标**：`test-plan.md:12` 明确写"不谎称已验证"，`contract.md` 结果列全为"待验"，`requirements.md` 把"不处理 Android 15 六小时上限本身"列为非目标——这三处没有把未验证包装成已验证，是本轮产物里质量最高的部分。

### 2.1 维度一：根因充分性 —— 不充分（3 条路径能解释异常类型，但一条都没有被证据锚定到本次崩溃）

`analysis.md` §五 的三条路径（catch 后 stopSelf / stopService 抢先 / 重复投递悬空）在**机理上**都成立，但审查标准是"是否真的能解释这次崩溃"，而不只是"是否可能导致这类异常"：

1. **缺时序对账，根因停在假设层**。崩溃时刻 `2026-10-26T14:30:55.701Z` 与 JS 侧 turn 边界、store 变更、`AppState` 变化没有任何一次并置。而 `CrashReporter` 本来就把崩溃落盘到 `filesDir/last-crash.txt`（`CrashReporter.kt:38-46`，用户贴出的正是这份文件的格式化输出），同一 `filesDir` 下的应用行为日志/会话时间戳足以做一次对账，分析没做。按 `handbook/diagnose.md` 的四维验证（时序/排他/充分/必要），当前结论只做了"充分性"的机理论证，时序与排他两维空白。
2. **遗漏路径 a：模块生命周期是第三条 stop 通道**。`HermesKeepAliveModule.OnDestroy`（`HermesKeepAliveModule.kt:56-58`）在 `state != IDLE` 时直接 `stopService`。RN 上下文销毁（reload、DevSettings、宿主重建）会命中它，而 `I1` 只把停服归因到 JS 的 `KeepAlive.stop()`。这条路径的触发者不是业务代码而是框架，稳定性比 I1 更高（每次 reload 必现），却完全没进清单。
3. **遗漏路径 b：六小时限额之后是静默失效，不是崩溃**。`onTimeout` 只 `stopSelf`（`KeepAliveService.kt:52-60`），服务被系统收走后，JS 侧 `running` 只有在 `label` 变化时才会走 `update()` 探活（`TurnEffects.tsx:98` 的 `if (label === shown) return`）。label 不变则 JS 永远认为服务在跑，保活实际已死。这直接削弱 G4，且它不在三路径里——说明分析只盯"崩"，漏掉了"功能悄悄失效"这一半。
4. **遗漏路径 c：没有给出任何可复现步骤**。`useSettings.subscribe(sync)`（`TurnEffects.tsx:109`）意味着用户切换 `keepAlive` 开关会确定性地产生 `stop()` → `start()` 紧邻序列，这是不需要任何竞态条件的最小复现用例，`requirements.md` / `analysis.md` 均未提供。根因未复现即进实现，是在赌。
5. **I2 的置信度被高估**。"`ensureChannel`/`build` 抛异常"标为"高"缺乏机理支撑：`ensureChannel`（`KeepAliveService.kt:83-92`）对"渠道已存在但被用户置为关闭/重要性 NONE"不会抛异常（`getNotificationChannel != null` 直接 return，`createNotificationChannel` 幂等）；`build()` 的唯一确定性失败源是 `R.drawable.ic_stat_hermes` 缺失，属编译期资源，发布包内不可能缺。真正会发生的失败（通知非法）反而**无法被这条 catch 捕获**（见 2.3-2）。I2 应降为"低"或改写为"通知非法导致 AMS 判定违约"。
6. **I4 方向正确但被判据自我否定**。主线程阻塞是合理路径，但 `tech-design.md:11` 用"系统判定同样迟到"把它一句话划掉——该论断错误，见 2.3-3。

### 2.2 维度二：可行性矩阵真实性 —— 8 项里 4 项证据链不成立（P1/P3/P6/P7）

| 项 | 声称 | 复核结论 |
|---|---|---|
| P2 | `onStartCommand` 首行 `startForeground` | 位置可改，结论成立；但"可行"仅指位置，不解决 2.3-1/2.3-2 的 catch 无效问题 |
| P4 | 看门狗只杀 STARTING | 成立。`ServiceState` 三态在 `KeepAliveService.kt:21`，赋值点与矩阵描述一致 |
| P5 | 降级分支先 stop | 缺陷描述与 `TurnEffects.tsx:100-104` 一致，成立（但契约 C6 指错了分支，见 2.4-1） |
| P8 | 静态断言可行 | 成立。`verify-fixes.mjs:515-575` 的 Test 21/22 确实 `readFileSync` 生产文件后 `includes`；注意同文件 Test 1/2/20 是"就地重写一份逻辑再断言"的反模式，不宜作为范式继承 |
| **P1** | `start()` 时 `reactContext` 可用 | **循环论证**。`tech-design.md:9` 用"`context` getter 已依赖该前提并通过现有代码验证"当证据，但被验证的只是 getter 能取到 context（因为 start 早就被调用过），从未验证过"在 `startForegroundService` 之前创建 channel 一定成功"。结论大概率仍成立（`getSystemService(NOTIFICATION_SERVICE)` 不依赖主线程），但 ✅ 的支撑是空的 |
| **P3** | 主线程 Handler 可行 | **证明手段与结论错配 + 备选预案错误**。证据引 `CrashReporter.kt` 的 `OnCreate` 注册（`HermesKeepAliveModule.kt:17-19`）证明"模块运行在主线程"，但 `OnCreate` 的线程属性推不出 `Function("start")` 的执行线程。用 main Handler 本身没问题，真正的问题是备选预案里"系统 5 秒判定同样迟到"——见 2.3-3 |
| **P6** | 300ms 冷却 | **常数无依据**。证据只证明"存在 stop-before-foreground 竞态"，没有任何证据表明 300ms 足以覆盖 `ServiceRecord` 的异步销毁重建；且该冷却在 2.3 的伪代码里根本没被调用（见 2.3-6） |
| **P7** | 纯函数可在 vitest 真 import | **数字失真**。`tech-design.md:15` 称 `tests/download.test.ts` "49 项用例通过"，实测该文件 18 项（`grep -c`），49 是全仓 7 个测试文件合计（5+5+18+8+4+4+5）。结论成立，证据错配 |

### 2.3 维度三：方案正确性 —— 4 处 high，其中 2 处会让"修复"复现原缺陷

1. **2.1 的 catch 保留了被自己判定为致命的动作**。`tech-design.md:31-35` 仍是 `state=IDLE; stopSelf(); return START_NOT_STICKY`；而 `analysis.md` F3/F11 明确把"`stopSelf` 而不 `startForeground`"定为致命路径。也就是说，修完的代码里 `stopSelf` 依然出现在"尚未成功提升前台"的位置，路径 #1 只是从"必然命中"变成"命中时照崩"。P2 的备选预案（catch 内用最简 Builder 重建再试一次）在 2.1 里没有落地，等于写了但不用。
2. **`try { startForeground } catch` 抓不到它想抓的异常**。`BadNotificationForStartForeground` 由 AMS 侧产生，以 `RemoteServiceException` 形式回投 App 主线程（堆栈形态为 `ActivityThread.throwRemoteServiceException` ← `ActivityThread$H.handleMessage`，与本次崩溃同一投递机制；参见 androidx/media#3401、openhab#2206、robospice#430、android/connectivity-samples#2 的堆栈）。服务内的 try/catch 对它完全无效。推论：`contract.md` B1「catch → 进程不崩」在机制上不可能成立；唯一有效的防线是**投递前**保证通知合法（channel 存在 + icon 非零 + type 合法），一旦投递出去，通知非法就必崩。方案把防线放在了唯一无效的位置。
3. **P3 备选预案的"窗口后移"论断错误，且它正是放弃处理 I4 的理由**。系统侧计时在 system_server，App 主线程阻塞只推迟**上报**、不推迟**判定**（本次堆栈第 17-18 行就是 AMS 回投的证据；官方 troubleshooting 页对超时口径只说 "a few seconds"，从未提及阻塞可延后截止）。结论：主线程阻塞场景下，看门狗（主线程 Runnable）与首行 `startForeground`（同样在主线程）**双双失效**，方案对该路径零防御，却以错误论断宣布已覆盖。
4. **看门狗动作与 F11 同构，可能把 5 秒违规提前成 4 秒违规**。`state == STARTING` 的语义正是"已投递、尚未 `startForeground` 成功"；此时 `stopService`（`tech-design.md:68-73`）与"`startForeground` 之前调 `stopService`"在 ServiceRecord 视角上等价。要么无效（`onStartCommand` 消息通常先于 4 秒定时器入队），要么把一个系统超时替换成自己的违规。看门狗应当只做 **JS 侧认知复位**（把 state 置 IDLE 让 `update()` 返回 false），停服交给系统或 `onTimeout`，不做 `stopService`。
5. **ensureChannel 移出 `onStartCommand` 后，首启窗口只剩模块侧一次机会**。`contract.md` A7 靠 `grep` 守卫"只有 1 处投递"，一旦将来新增第二个投递点（或 prebuild 生成代码里出现），channel 缺失就会退化为不可捕获的 `BadNotificationForStartForeground`。建议在模块层把 `ensureChannel` + "通知可 build" + "type 权限在位" 合成一个 preflight 函数，任何投递点必须先过 preflight，并把 A7 从 grep 升级为"投递调用点前必须出现 preflight"的静态断言；而不是简单地"从 onStartCommand 里删掉"。
6. **2.3 的伪代码没有使用新增的两个纯函数**。`tech-design.md:80-95` 的 `sync()` 里既没有 `canStartNow` 也没有 `nextBackoffMs`，也没有引入 `lastStopAt` / `failStreak` 状态；`KeepAlive.stop()`（`modules/hermes-keepalive/index.ts`）是 fire-and-forget、无返回值，`lastStopAt` 在架构上无处安放。结果：`contract.md` C7/C8/B4/B5 要单测的是**生产代码不引用的死代码**。
7. **`label === shown` 早退保留，B7 通道在 label 不变时不可达**。`TurnEffects.tsx:98` 不变，则 `running && !KeepAlive.update(...)`（`:100`）只有在 label 变化时才被评估；`onTimeout` 或用户从系统设置停服后，JS 会长期持有 `running = true`，keepAlive 静默失效（G4 受损，同 2.1-3）。方案缺一个"事件性/周期性探活"，例如在 `AppState` 变为 `active` 时无条件 `update()` 一次做探针。
8. **悬空实现**：2.1 写入 `lastStartError`（`tech-design.md:33`），但矩阵、"不变项"、契约均未声明该字段，也未暴露给 JS 或日志。要么删，要么在 `CrashReporter` 旁落盘，否则是实现时的自由发挥点。

### 2.4 维度四：契约可验性 —— 8 条 C 里 4 条守不住，7 条 B 里 2 条机制上不可验，7 条 A 里 1 条是空门禁

1. **C6 在未修复的代码上就已通过**。现码 `TurnEffects.tsx:86-90` 已是 `if (running) KeepAlive.stop(); running = false`，C6 断言的正是这个形状 → 零鉴别力。真正要改的是 `update()` 返回 false 的分支（`:100-104`，也就是 P5 / §2.3 自己写的修改点）。契约与修改点错位。
2. **C1 措辞允许保留根因**。C1 写"其前不得有 `ensureChannel` / `build` 之外的副作用调用"，即**允许 `build()` 在 `startForeground` 之前**；而 F2 把"`build` 在 try 外"当根因。按 C1 写出的实现可以合法地在 try 外 `build()`，通过 C1 却复现原缺陷。条文与根因自相矛盾。
3. **"源码断言文本包含"整体不可证伪**。C1-C4、C6、A6 全是 `includes` 形态；一行注释 `// must call startForeground` 即可满足"前 200 字符含 startForeground"，被注释掉的代码同样通过。这类断言只能防"删掉调用"，防不了"调用顺序被破坏"这一真正的回归。
4. **C5 指向不存在的被测对象**。`shouldWatchdogAbort(state)` 在设计与实现中都没有——2.2 是内联 `if (state == ServiceState.STARTING)`。要么抽成纯函数，要么删掉 C5。
5. **B1 把"无法验证"写成了"待验"**。B1 的预期含"进程不崩"，这是运行时属性，而按 `test-plan.md` 分层它只能落到 L2 静态断言（TC-KA-03 未定义，见 2.5-5）。更关键的是 2.3-2 已证明该预期机制上不成立——这一条如果进交付清单，一定被读成"已验证不崩"。
6. **A5 是空门禁**。`verify-fixes.mjs` Test 20（`:503-513`）只对本地构造的对象字面量做 `assert.ok`，不读任何生产文件，与"会话删除 RPC 契约"毫无绑定关系。把它列为相邻影响守护项是虚的。
7. **A6 覆盖面不足**：只断言 `NOTIFICATION_ID=9119` / `CHANNEL_ID` 字符串，未断言渠道重要性（`IMPORTANCE_LOW`）与文案；而重要性直接影响通知可见性与"用户看不到通知"类反馈。
8. **A7 的判据不稳定**：未写清搜索根与 `--include`；现在实测 `modules/ src/` 下仅 `HermesKeepAliveModule.kt:34` 一处，但 prebuild 产出 `android/` 后会引入生成代码，断言会误报。
9. **契约缺"责任层"列**。C1-C8/B1-B7/A1-A7 只写了验证方式，没写由 L1/L2/L3/L4 哪一层执行。C1-C4/A6 本可 O(1) 成本守住，交付时却无法核对到具体执行体，等于把"哪一条真的跑了"留给交付人自由裁量。

### 2.5 维度五：测试覆盖充分性 —— 取舍理由不成立，且 L3 直接违反本仓铁律

1. **L3 违反 `AGENTS.md` 明令**。`test-plan.md:9` 的"L3 状态机推演单测（vitest 模拟 ServiceState 迁移）"= 在 TS 侧重写一份三态机再断言这份重写，与 Kotlin 生产代码（`KeepAliveService.kt:21-43`）零共享。这正是 `AGENTS.md`「严禁测试自欺欺人与循环自证：单测严禁在测试文件内手写 mock 假函数然后测试假函数」，也违反本轮任务说明里"案例必须先于交付"的同一精神。这条不能算覆盖，算覆盖的反面。
2. **"放弃 Kotlin JVM 测试"的理由不成立**。理由写"仓库无该测试源集，新增属于独立工程改造"，但模块 `build.gradle` 只有 19 行，加两行 `testImplementation "junit:junit:4.13.2"` + `testImplementation "org.jetbrains.kotlin:kotlin-test"` 就能让**无 Android 依赖的纯 Kotlin 决策类**在 JVM 上跑；把"该不该 stopSelf / 该不该启看门狗 / 状态迁移"抽成一个零依赖 `object KeepAliveDecider`，`gradlew :hermes-keepalive:testDebugUnitTest` 即可，不需要 Robolectric、不需要真机、不需要预构建。真实成本只在"接进 `npm test`"（现在 `npm test` = `vitest run && node scripts/verify-fixes.mjs`），这一项应如实写成 **"CI 未接入"**，而不是 **"不可做"**。
3. **Robolectric 被完全略过**。若要求覆盖"`onStartCommand` 首行确实调用 `startForeground` 且顺序正确"，`Robolectric.buildService(KeepAliveService::class.java).create().startCommand(0,0)` + `ShadowService.getLastForegroundNotification()` 是可行且低成本的（约 3 个依赖、1 个测试类、JVM 内跑）。方案应显式列为"可选增强"并给出成本，而不是完全不提，让读者以为只有真机一条路。
4. **通过标准数字自相矛盾**。当前 vitest 实数 49（auth-url 5 + cron 5 + download 18 + history 8 + links 4 + metrics 4 + reasoning 5），`test-plan.md:22` 要求 ≥55；`test-plan.md:23` 说 verify-fixes ≥23（新增 1 项），而契约里至少 C1-C4/C6/A6/A7 六条需要新增断言。按现契约实施，两组数字必然对不上，验收时会变成"改门槛"而不是"补断言"。
5. **`test-cases.md` 不存在**。`test-plan.md:16` 指向它，目录内实有 6 个 md 且无该文件；`contract.md` 的 TC-KA-03~09 全部无定义。用例与断言的对应关系在交付时无从核对。
6. **L4 缺可执行判定步骤**。写了"通知出现、后台不被冻结、连续开关不闪退"，但没给操作序列与观测命令（例如：连点 `keepAlive` 开关 20 次；`adb shell dumpsys activity services com.azygoss.hermes | grep -A8 hermeskeepalive` 观察 `isForeground`；`adb shell dumpsys notification --noredact | grep hermes-working`）。"不闪退"不可复现，就无法在下一轮回归时复用。

### 2.6 问题清单

| # | 类型 | 问题描述 | 引用位置 | 严重度 | 解决建议 |
|---|---|---|---|---|---|
| 1 | 根因 | 三条路径均未与崩溃时间戳/会话事件对账，"根因"停在机理假设，缺时序与排他两维验证 | `analysis.md` §五；崩溃时刻 `2026-10-26T14:30:55.701Z`；`CrashReporter.kt:38-46` | high | 用 `filesDir/last-crash.txt` + 会话/store 时间线做一次对账，或给出确定性复现步骤后再定根因 |
| 2 | 根因 | 遗漏第三条 stop 通道：模块 `OnDestroy` 在 state≠IDLE 时 `stopService`，RN 上下文销毁即命中，与 I1 同源但触发者不同 | `HermesKeepAliveModule.kt:56-58`；`analysis.md` I1 | high | 把模块生命周期停服列入路径清单，并在 `OnDestroy` 里改走"先置 IDLE 再停"的同一收口 |
| 3 | 根因 | 无复现路径：`keepAlive` 开关切换会确定性产生 stop→start 紧邻序列，是零成本最小复现用例，却未给出 | `TurnEffects.tsx:109`；`requirements.md` 全文 | medium | 补充复现步骤（开关连点 N 次、后台 6h 等 `onTimeout`）并纳入 L4 |
| 4 | 根因 | I2 置信度标"高"缺乏机理：渠道被禁用不会让 `ensureChannel` 抛异常，`build` 唯一失败源是编译期资源 | `KeepAliveService.kt:83-92`；`analysis.md` I2 | medium | 降级为"低"或改写成"通知非法 → AMS 判定违约"，并指向 2.3-2 的正确防线 |
| 5 | 根因 | 六小时限额后是静默失效（非崩溃）：`onTimeout` 停服后 JS `running` 不复位，保活实际已死 | `KeepAliveService.kt:52-60`；`TurnEffects.tsx:98` | medium | 列入路径清单；补 label 不变时的探活（见 #12） |
| 6 | 可行性 | P1 循环论证：用"getter 已依赖该前提"证明"start() 时 context 可用"，被验证的是 getter 而非 channel 前置创建 | `tech-design.md:9`；`HermesKeepAliveModule.kt:11-12` | medium | 换证据：`getSystemService(NOTIFICATION_SERVICE)` 的线程/上下文要求，或直接以"投递前 preflight 成功"作为条件 |
| 7 | 可行性 | P3 证明手段错配（用 `OnCreate` 的主线程属性推 `Function("start")` 的执行线程），且备选预案"窗口后移"错误 | `tech-design.md:11`；`HermesKeepAliveModule.kt:17-19` | high | 明确 `Function` 的实际执行线程；删除"窗口后移"，改为承认主线程阻塞下看门狗与首行 startForeground 同时失效 |
| 8 | 可行性 | P6 的 300ms 常数无依据，且该冷却在 2.3 未被调用 | `tech-design.md:14`；`tech-design.md:80-95` | medium | 要么去掉冷却（改为事件驱动的"服务已销毁"信号），要么给出测量依据并真正接进 `sync()` |
| 9 | 可行性 | P7 数字失真：`download.test.ts` 实为 18 项，49 是全仓合计 | `tech-design.md:15`；`tests/download.test.ts` | low | 改正为 18 项并注明 49 为全仓总量 |
| 10 | 方案 | 2.1 的 catch 仍 `stopSelf()` 而不 `startForeground`，保留 F3/F11 判定的致命动作，路径 #1 未封住；P2 备选预案未落地 | `tech-design.md:27-36`；`analysis.md` F3/F11 | high | catch 内改用预置的最小静态通知再试一次 `startForeground`；确实不行时也不 `stopSelf`（停服交给系统，避免同构违规） |
| 11 | 方案 | `try { startForeground } catch` 抓不到 `BadNotificationForStartForeground`（AMS 回投的 RemoteServiceException），B1 的"进程不崩"机制上不成立 | `tech-design.md:27-36`；`contract.md` B1；`ActivityThread$H.handleMessage` 堆栈 | high | 防线前移到投递前的 preflight（channel 存在 + icon 非零 + type 权限），并改写 B1 预期 |
| 12 | 方案 | 看门狗动作 `stopService` 与 F11 同构：STARTING 期间停服等价于"startForeground 前 stopService"，可能把 5s 违规提前为 4s 违规 | `tech-design.md:68-73`；`analysis.md` F11 | high | 看门狗只做状态复位（让 `update()` 返回 false），不调 `stopService` |
| 13 | 方案 | `label === shown` 早退使 B7 通道在 label 不变时不可达，服务静默死亡后 JS 永不复位 | `TurnEffects.tsx:98-106`；`contract.md` B7 | medium | 加探活：`AppState → active` 时无条件 `update()` 一次；或定期探针 |
| 14 | 方案 | ensureChannel 移出 `onStartCommand` 后仅剩模块侧一次机会，新增投递点即退化为不可捕获的坏通知 | `tech-design.md:41`；`contract.md` A7 | medium | 模块层建 preflight 并让所有投递点强制前置；A7 由 grep 升级为该结构的静态断言 |
| 15 | 方案 | 2.3 伪代码未调用 `canStartNow`/`nextBackoffMs`，也未引入 `lastStopAt`/`failStreak`；`KeepAlive.stop()` 无返回值无处记时 | `tech-design.md:80-102`；`modules/hermes-keepalive/index.ts` | high | 补齐 `sync()` 的状态字段与调用点，或删掉 C7/C8/B4/B5 |
| 16 | 方案 | `lastStartError` 在 2.1 被写入但从未声明、未暴露 | `tech-design.md:33` | low | 删除，或在 `CrashReporter` 旁落盘并在契约中登记 |
| 17 | 契约 | C6 在未修复代码上即成立（现码已先 stop 再置 false），零鉴别力；真正修改点被漏掉 | `contract.md` C6；`TurnEffects.tsx:86-90` vs `:100-104` | high | 把 C6 改写到 `update()` 返回 false 的分支，并断言其顺序 |
| 18 | 契约 | C1 条文允许 `build()` 前置，与 F2 根因矛盾，按 C1 实现可合法复现原缺陷 | `contract.md` C1；`analysis.md` F2 | high | 改为"`startForeground` 之前不得出现 `build`/`ensureChannel` 等任何可抛调用" |
| 19 | 契约 | 验证方式以 `includes` 文本包含为主，注释/字符串/被注释代码均可通过，不可证伪 | `contract.md` C1-C4/C6/A6；`scripts/verify-fixes.mjs:515-575` | medium | 先 `stripComments` 再比 index 顺序；或对关键项改用 Robolectric 行为断言 |
| 20 | 契约 | C5 断言的 `shouldWatchdogAbort` 不存在，2.2 为内联判断 | `contract.md` C5；`tech-design.md:69` | medium | 抽成纯函数并纳入 Kotlin JVM 测试，或删除该条 |
| 21 | 契约 | B1 把"进程不崩"写成"待验"，实际不可静态验证且机制上不成立 | `contract.md` B1；`test-plan.md` §一 | medium | 改写预期为"投递前拦截非法通知，投递后不再有非法通知"，并标注 L2 责任层 |
| 22 | 契约 | A5 空门禁：Test 20 只断言本地构造对象，不读生产文件 | `contract.md` A5；`scripts/verify-fixes.mjs:503-513` | medium | 换成对真实调用点的 `readFileSync` 断言，或删除该条并说明无相邻影响 |
| 23 | 契约 | A6 未覆盖渠道重要性与文案；A7 判据未限定搜索根与 `--include`，prebuild 后会误报 | `contract.md` A6/A7 | low | A6 增断言 `IMPORTANCE_LOW` 与通知文案；A7 限定 `--include=*.kt` 与固定根 |
| 24 | 契约 | 契约缺"责任层（L1/L2/L3/L4）"列，交付时无法核对哪条真的执行过 | `contract.md` §一至§三 | medium | 增一列责任层，并在 `test-plan.md` 通过标准里做逐层对账 |
| 25 | 测试 | L3"状态机推演单测"在 TS 侧重写三态机，与 Kotlin 生产代码零共享，违反 `AGENTS.md` 禁循环自证铁律 | `test-plan.md:9`；`KeepAliveService.kt:21-43` | high | 删除 L3；改为纯 Kotlin 决策类的 JVM 单测（见 #26） |
| 26 | 测试 | "放弃 Kotlin JVM 测试"理由不成立：加两行 `testImplementation` 即可对零 Android 依赖的决策类做 JVM 单测；真正成本是"未接进 npm test" | `test-plan.md:12`；`modules/hermes-keepalive/android/build.gradle`(19 行)；`package.json:77` | high | 抽 `KeepAliveDecider` 纯 Kotlin 类 + JUnit4；在文档中写"CI 未接入"而非"不可做"，并给出接入任务 |
| 27 | 测试 | Robolectric 被完全略过，未评估其低成本覆盖 `onStartCommand` 顺序的能力 | `test-plan.md` §一 | medium | 列为可选增强：`Robolectric.buildService` + `ShadowService.getLastForegroundNotification()` |
| 28 | 测试 | 通过标准数字不自洽：vitest 实数 49 vs 要求 ≥55；verify 要求"新增 1 项"vs 契约至少 6 项新断言 | `test-plan.md:22-23`；`tests/*.test.ts` 实数；`contract.md` C1-C4/C6/A6/A7 | medium | 按契约实际新增用例数重算门槛，并把每条断言映射到用例编号 |
| 29 | 测试 | `test-cases.md` 不存在，TC-KA-03~09 无定义 | `test-plan.md:16`；`contract.md` B1-B7 | medium | 补该文件并列出 7 条用例的输入/预期/对应契约号 |
| 30 | 测试 | L4 无操作序列与观测命令，"不闪退"不可复现 | `test-plan.md:10` | low | 补：开关连点 20 次、后台等 `onTimeout`、`dumpsys activity services` 观测 `isForeground` |

严重度分布：high 11 / medium 15 / low 4（共 30 条）。

### 2.7 评分与准入建议

| 维度 | 得分 | 依据 |
|---|---|---|
| 分析（根因充分性） | 6.5 / 10 | 事实清单质量高、F10 归因正确、版本一致性与诚实性到位；但根因未与证据对账、漏两条路径、I2 置信度过高、无复现步骤（#1-#5） |
| 设计（可行性矩阵真实性） | 5.0 / 10 | P2/P4/P5/P8 站得住；P1 循环论证、P3 证据错配且结论错误、P6 常数无依据、P7 数字失真（#6-#9） |
| 技术方案正确性 | 4.5 / 10 | 方向对，但 catch 保留致命动作、对不可捕获异常做了无效防御、看门狗动作自相矛盾、新增纯函数未接线——按现方案实施，崩溃概率下降但未消除，且新增了一个 4s 违规面（#10-#16） |
| 测试覆盖充分性 | 3.5 / 10 | L3 违反铁律，L1/L2 之外无真实 Kotlin 覆盖，"不可做"结论不成立，门槛数字与用例文件均不齐（#25-#30） |
| **加权（分析 0.2/设计 0.2/方案 0.4/测试 0.2）** | **4.6 / 10** | 低于"有条件通过"的及格线 |

**准入建议：驳回（Revise & Resubmit）。**

必须先行闭环的四项才可重审（每项都指向"方案是否真的封住路径"，不是文档措辞问题）：

1. **把防线前移到投递前的 preflight**（#11/#14）：接受"投递后通知非法必崩且不可捕获"，把 channel/icon/type 校验做成模块层单一 preflight，任何投递点强制前置，A7 升级为结构性静态断言。
2. **重写失败与看门狗语义**（#10/#12）：服务内失败路径不得在"未成功前台化"时 `stopSelf`；看门狗只做状态复位不做 `stopService`。
3. **根因证据化**（#1/#2/#3）：给出至少一条可复现路径（开关连点 / `OnDestroy` 通道）与一次时序对账，否则"根因"二字不成立。
4. **测试栈取舍重做**（#25/#26）：删掉 L3，改用纯 Kotlin 决策类 + JUnit4（若确实不做，则必须在契约中把 C2/C5/B3/B4/B5 标记为"未覆盖"而不是"待验"）；同时补齐 `test-cases.md` 与门槛数字。

建议保留的产物：`analysis.md` 事实清单（F1-F11）、`requirements.md` G1-G5、方案对比表 A/B/C 的淘汰逻辑——这三块可以直接进下一版。

## 三、裁决

### 3.1 审查质量校验

| 检视项 | 结果 | 说明 |
|-------|------|------|
| 每个发现是否有具体引用位置 | ✅ 30/30 | 全部带文件名+行号或章节号，无空泛描述 |
| 维度覆盖是否完整 | ✅ 5/5 | 根因 / 可行性矩阵 / 方案正确性 / 契约可验性 / 测试覆盖，逐维度展开且写明了"成立"的部分 |
| 严重度是否有区分 | ✅ | high 11 / medium 15 / low 4 |
| 是否有独立分析而非复述 | ✅ | 自行发现了我自审未发现的 27 条，含 3 条我判断错误的地方（P1 循环论证、P3 证明错配、P6 常数无依据） |

**审查有效性：通过。** 不标记"审查无效"，无需重审。

### 3.2 差异点仲裁（自审 vs sub-agent）

| 议题 | 自审判定 | sub-agent 判定 | 裁决 |
|------|---------|--------------|------|
| catch 内 `stopSelf` 是否致命 | S4：成立，需承认 | #10：high，路径 #1 未封住 | **一致，采纳**。v2 已改为"catch 内先兜底重试 `startForeground`，两次都失败才 `stopSelf`"，并在矩阵 P3 备选预案里如实写明"此时已无合规动作" |
| 看门狗能否 `stopService` | S2：论证不足 | #12：与 F11 同构，可能把 5s 违规提前成 4s | **一致，采纳**。v2 的看门狗只置 `UNCONFIRMED` 并记录时刻，不碰生命周期 |
| `BadNotificationForStartForeground` 可否 catch | S4 未涉及 | #11：high，"完全抓不到" | **部分采纳**。症结判断正确（防线必须前移），但"完全抓不到"过于绝对：该异常存在**同步 RuntimeException 形态**（`startForeground()` 调用栈内直接抛，可 catch）与**异步 `RemoteServiceException` 形态**（经 `ActivityThread$H` 回投，不可 catch）两种。因此 v2 采用双防线：P1 preflight 拦在投递前（对两种形态都有效），P3 catch 兜底只对同步形态有效。技术矩阵里已把 P3 的有效范围如实限定，不再声称"进程不崩" |
| Kotlin JVM 测试是否必做 | S5：取舍合理 | #26：high，理由不成立 | **部分采纳**。接受"理由不成立"的批评 —— v1 写"不可做"是错的，v2 改为"CI 未接入"。但不采纳"本次必做"：#26 建议抽 `KeepAliveDecider` 纯 Kotlin 类，那属于**重构**而非修复，本变更 Kotlin 侧改动全部是调用顺序与"不调用某方法"，JUnit 断言不到这类结构约束。可算法化的部分（冷却、退避）已下沉到 `keepAlivePolicy.ts` 由 vitest 真实覆盖。抽 `KeepAliveDecider` 列入遗留问题跟踪 |
| L3 状态机推演单测 | S5 未发现 | #25：high，违反禁循环自证铁律 | **采纳，已删除**。v2 的 `test-plan.md` 显式记录了删除原因 |
| 根因是否需时序对账 | 未涉及 | #1：high | **采纳但降级执行**。时序对账需要真机 `filesDir/last-crash.txt` 与 logcat，本环境无设备，无法取证。改为给出**确定性复现路径**（`keepAlive` 开关连点产生 stop→start 紧邻序列），并列入 L3 真机验证步骤，如实标注为待用户执行 |
| 模块 `OnDestroy` 通道 | S 未发现 | #2：high | **采纳**。v2 已列入 P9 并移除该 `stopService` |
| 六小时限额后静默失效 | 未涉及 | #5：medium | **采纳分析结论，不采纳本次加探活**。F13 已补进事实清单；探活属新增功能，改动面扩大，列入遗留 |
| `label === shown` 早退导致探活缺失 | 未涉及 | #13：medium | **采纳问题，本次不加探活**。理由同上，列入遗留问题并在 `summary.md` 标注风险 |

### 3.3 裁决结论

**v1 设计驳回成立。** 已按上述裁决完成 v2 全量重写：

| 文档 | 修订内容 |
|------|---------|
| `analysis.md` | 补 F12（模块 OnDestroy 通道）、F13（六小时限额是静默失效非崩溃）、F14（两种异常形态）；修正 I4 的错误论证；补三条 stop 通道说明 |
| `tech-design.md` | 全文重写。确立铁律"`startForeground` 成功前禁止任何 stop"；P1 改为投递前 preflight、P3 改为兜底重试且限定有效范围、P4 看门狗只上报、P9 移除 OnDestroy 的 stopService；§2.3 补 `lastStopAt`/`failStreak`/`retryAfter` 状态字段并真实调用纯函数 |
| `contract.md` | C1 改为下标比较并要求 `build` 与 `startForeground` 同处 try；C5 改为"看门狗内不含 stop 动作"；C6 改指 `update()` 失败分支；C7/C8 改为"生产代码真实调用"；新增 C9；新增第四节"明确不承诺的项" |
| `test-plan.md` | 删除 L3 循环自证层；Kotlin 取舍理由改写为"CI 未接入"；门槛数字按实数重算（61 单测 / 23 套件） |
| `test-cases.md` | 新建，18 条用例，每条标注执行层与关联契约号 |

**准入结论：v2 准予进入 Phase 2 实施。** 但必须在实施后由代码审查独立复核以下四点是否真的落地，不接受"文档写了代码没写"：

1. `onStartCommand` 内 `startForeground` 下标小于 `stopSelf` 与 `ensureChannel`
2. 首个 catch 块内不含 `stopSelf`
3. 看门狗 Runnable 内不含 `stopService` / `stopSelf`
4. `sync()` 真实调用 `canStartNow` 与 `nextBackoffMs` 且二者下标在 `KeepAlive.start` 之前

