# 分析：KeepAliveService 前台服务 5 秒超时闪退

## 一、事实清单（均为源码/官方文档确证，非推断）

| # | 事实 | 证据来源 |
|---|------|---------|
| F1 | 调用 `startForegroundService()` 后，服务必须在数秒内（实践口径 5 秒，等同 ANR 区间）调用 `startForeground()`，否则系统抛 `ForegroundServiceDidNotStartInTimeException` 并让**主线程**崩溃 | Android 官方 *Troubleshoot foreground services* 文档「Internal exception: ForegroundServiceDidNotStartInTimeException」小节 |
| F2 | `KeepAliveService.onStartCommand()` 中，`ensureChannel(this)` 与 `build(...)` 在 `try` **之外**，只有 `ServiceCompat.startForeground(...)` 被 try 包住 | `modules/hermes-keepalive/.../KeepAliveService.kt:29-33` |
| F3 | `catch` 分支执行 `state = IDLE; stopSelf(); return START_NOT_STICKY`，即异常路径下**永远不会调用 startForeground** | `KeepAliveService.kt:34-39` |
| F4 | `start()` 仅把 intent 投递给系统就 `return true`，不等待服务真正进入前台；失败时返回 false | `HermesKeepAliveModule.kt:28-41` |
| F5 | `stop()` 直接 `context.stopService(...)`；模块 `OnDestroy` 在 state 非 IDLE 时同样调用 stopService | `HermesKeepAliveModule.kt:52-58` |
| F6 | JS 侧 `sync()` 在 `want === false` 时调用 `KeepAlive.stop()`，在 `AppState === 'active'` 且 `!running` 时调用 `KeepAlive.start()`；`sync` 被 `useChat.subscribe` / `useSettings.subscribe` 订阅，store 每次变更都会触发 | `src/components/chat/TurnEffects.tsx:82-107` |
| F7 | `sync()` 中 `running` 降级为 false 的路径（`KeepAlive.update()` 返回 false 或 AppState 非 active）**不会调用 stop()**，服务可能仍在运行，而下一轮 sync 会再次 `start()` | `TurnEffects.tsx:100-105` |
| F8 | 模块清单已声明 `FOREGROUND_SERVICE` 与 `FOREGROUND_SERVICE_DATA_SYNC` 权限，service 已声明 `android:foregroundServiceType="dataSync"` | `modules/hermes-keepalive/android/src/main/AndroidManifest.xml:2-10` |
| F9 | `onTimeout(startId, fgsType)` 与旧签名 `onTimeout(startId)` 均已实现 `stopSelf()`，用于 Android 15 dataSync 时限兜底 | `KeepAliveService.kt:52-60` |
| F10 | 崩溃发生在 `thread: main`，异常由 `ActivityThread.generateForegroundServiceDidNotStartInTimeException` 抛出，属于**系统对 App 的违约判定**，不是应用自己 throw 的 | 用户提供的堆栈 |
| F11 | 社区已确证另一条同源路径：若在 `startForeground()` 之前调用了 `stopService()`，系统同样会判超时崩溃 | AWS Amplify Android issue #1868 讨论；androidx/media issue #112 |
| F12 | 存在**第二条 stop 通道**：Expo 模块 `OnDestroy` 在 `state != IDLE` 时主动 `context.stopService(...)`，与 JS 侧 `stop()` 相互独立 | `HermesKeepAliveModule.kt:56-58` |
| F13 | Android 15 dataSync 6 小时限额触发时，系统回调 `onTimeout`，服务 `stopSelf()` 后**静默失效，不崩溃**；崩溃只发生在"投递后未提升前台"这一条路径上 | `KeepAliveService.kt:52-60` + Android 官方 troubleshooting 文档「Short service runs too long causing ANR」小节（同章描述 dataSync/mediaProcessing 时限更长，超时"系统发送内部异常导致应用崩溃"指的是**未自行停止**的情形） |
| F14 | `ServiceCompat.startForeground()` 是**同步 binder 调用**，通道不存在时 system_server 抛 `BadNotificationForStartForeground` 并作为运行时异常回传给调用方，客户端可 catch；而 `ForegroundServiceDidNotStartInTimeException` 是 system_server 的**异步判定**，经 `ActivityThread$H.handleMessage` 回投主线程，客户端**无法 catch** | F10 堆栈（异步路径经 Handler 回投）+ AOSP `ActiveServices.setServiceForegroundInnerLocked` 同步抛异常的机制 |

## 二、推断清单（每条绑定事实，标明置信度）

| # | 推断 | 支撑事实 | 置信度 |
|---|------|---------|-------|
| I1 | **主因**：`stop()` 与紧随其后的 `start()` 构成服务销毁/重建竞态，导致某个 ServiceRecord 的 foreground 要求悬空，5 秒后被系统判死 | F5 + F6 + F7 + F11 | 高 |
| I2 | **次因**：`onStartCommand` 内 `ensureChannel`/`build` 抛异常（渠道被 ROM 限制、通知构造失败）时，异常路径直接 `stopSelf()` 而不 startForeground，等价于从未提升前台 | F2 + F3 + F11 | 高 |
| I3 | **放大器**：JS 侧重复投递 `start()`，同一进程内堆积多个 foreground 要求，任何一个未满足都会触发崩溃 | F4 + F7 | 中 |
| I4 | **放大器**：主线程被 RN bridge / 文件 IO 长时间占用时，`onStartCommand` 本身延迟超过 5 秒 | F1（5 秒基准）+ F10 | 中 |

> I4 补充说明（修正 v1 的错误论证）：计时发生在 system_server 侧，主线程阻塞**不会**让系统判定跟着推迟，只会推迟异常的回投与上报。因此 I4 是一条**真实存在且零防御**的路径，不能寄希望于"窗口后移"。
>
> 关于 stop 通道的补充：除 JS 侧 `stop()` 之外，模块 `OnDestroy` 也会触发 stopService（F12）。React Native 热重载、模块重建、页面栈重建都可能间接触发，使 stop 出现的时机不可控，这加重了 I1 的竞态概率。
>
> 关于 dataSync 限额：6 小时限额超时后服务 `stopSelf()` 静默失效（F13），**不会产生本次崩溃**。因此本变更不处理限额本身，只需保证限额之后 JS 侧再次 `start()` 时不制造悬空记账。

> 说明：I1 与 I2 并不互斥，两者都会独立触发同一异常。修复必须同时封住，只堵一条仍有概率崩。

## 三、现状与目标差距

| 目标 | 现状 | 差距 |
|------|------|------|
| G1 必有一次 startForeground | 异常路径完全跳过；正常路径也可能被 stopService 抢先 | 缺"无论如何先提升前台"的兜底 |
| G2 启动失败可感知 | `start()` 返回 true 只代表投递成功 | 缺看门狗与真实状态回执 |
| G3 竞态不产生悬空要求 | stop→start 无任何串行化或延迟保护 | 缺串行化/去重 |
| G4 保活不被削弱 | 现有通知与 type 声明完整 | 无差距，修复不得破坏 |
| G5 不引入依赖 | 现有实现未加依赖 | 无差距 |

## 四、方案对比

| 方案 | 描述 | 优点 | 缺点 | 风险 | 验证成本 | 推荐理由 | 不选理由 |
|-----|------|-----|-----|------|---------|---------|---------|
| A | 仅把 `startForeground` 提到 `onStartCommand` 首行 | 改动最小，1 处 | 封不住 I1（stop→start 竞态）与 I3（重复投递），仍会崩 | 高：等于只修了次因 | 低 | — | 遗留主因，问题会复现 |
| B（选） | 三层防御：① `onStartCommand` 首行无条件 `startForeground`（最简通知）② `start()` 加 4 秒看门狗，超时主动 stopService 并复位 IDLE ③ JS 侧对同一 label 去重 + 失败退避，且降级路径先 stop 再置 false | 三个已知触发路径全部封住；不改协议、不加依赖 | 代码量中等；看门狗需保证不误杀正在正常启动的服务 | 低：窗口设在 4 秒，短于系统 5 秒 | 中：需 Kotlin 单测 + 静态门禁 | ✅ 唯一能同时封住 I1/I2/I3 的方案 | — |
| C | 弃用前台服务，改 WorkManager / bindService 保活 | 彻底绕开 FGS 限制 | 无法长期保持 WebSocket；WorkManager 最小周期 15 分钟，保活语义尽失 | 极高：功能实际失效 | 高 | — | 直接牺牲 G4，不可接受 |

## 五、根因结论

本次崩溃的根因是**前台服务的状态机缺少"无论如何先提升为前台"的兜底，同时 JS 侧对服务的 start/stop 没有串行化与去重**。系统对每一次 `startForegroundService()` 都记账，而我们的实现存在三条不调用 `startForeground()` 的路径：

1. `ensureChannel`/`build` 抛异常 → catch 后 `stopSelf()`（F2/F3）
2. `stopService()` 抢先于 `startForeground()` 执行（F5/F6/F11）
3. 重复投递导致旧记录悬空（F4/F7）

三者共同表现为同一个系统异常，因此必须一并封堵，不能只修其一。

## 六、风险

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 看门狗误杀正常启动中的服务 | 窗口设为 4 秒（短于系统 5 秒）；看门狗触发前先查 `state === STARTING`，已 RUNNING 则不动 |
| R2 | 首行用最简通知 startForeground 后，随后美化更新通知可能闪一下 | 使用同一 notificationId；`setOnlyAlertOnce(true)` 已在 `build()` 内设置 |
| R3 | JS 侧退避导致用户久等仍无通知 | 退避只抑制"重复投递"，不抑制 `update()`；退避上限 30s 且 App 回到前台重置 |
