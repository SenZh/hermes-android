# 需求分析：修复前台服务 5 秒超时闪退

## 用户原始需求全文

> 刚才 APP报错了 闪退了
> 以下是信息
> Hermes 1.8.3-preview.16 · Android 36
> reason: crash · 2026-10-26T14:30:55.717Z
> crash
>
> thread: main
> time: 2026-10-26T14:30:55.701Z
> version: 1.8.3-preview.16
>
> android.app.RemoteServiceException$ForegroundServiceDidNotStartInTimeException: Context.startForegroundService() did not then call Service.startForeground(): ServiceRecord{fa16579 u0 com.azygoss.hermes/expo.modules.hermeskeepalive.KeepAliveService c:com.azygoss.hermes}
> 	at android.app.ActivityThread.generateForegroundServiceDidNotStartInTimeException(ActivityThread.java:2647)
> 	at android.app.ActivityThread.throwRemoteServiceException(ActivityThread.java:2615)
> 	at android.app.ActivityThread.-$$Nest$mthrowRemoteServiceException(Unknown Source:0)
> 	at android.app.ActivityThread$H.handleMessage(ActivityThread.java:3036)
> 	at android.os.Handler.dispatchMessage(Handler.java:116)
> 	at android.os.Looper.loopOnce(Looper.java:306)
> 	at android.os.Looper.loop(Looper.java:417)
> 	at android.app.ActivityThread.main(ActivityThread.java:10001)
> 	at java.lang.reflect.Method.invoke(Native Method)
> 	at com.android.internal.os.RuntimeInit$MethodAndArgsCaller.run(RuntimeInit.java:613)
> 	at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:1074)

随后补充的指令：

> 修完再打包

## 实现目标（可量化）

| # | 目标 | 可验证标准 |
|---|------|-----------|
| G1 | 任何一条 `startForegroundService()` 投递路径，都必须在系统 5 秒窗口内完成一次 `startForeground()` | 静态检查 `onStartCommand` 首条语句即 `startForeground` 调用；Kotlin 单测断言调用顺序 |
| G2 | 服务启动失败必须被感知并复位状态，不能让 JS 侧以为已经起来了 | `start()` 的返回值语义与 4 秒看门狗一致；看门狗触发后 `state === IDLE` |
| G3 | `stop()` 与 `start()` 紧邻发生（竞态）时不得产生未满足的 foreground 要求 | 服务在 `onDestroy` 前不留 pending 状态；JS 侧对同一 label 不重复投递 |
| G4 | 保活功能本身不可被削掉：agent 工作时应用退到后台仍要保住网关 WebSocket | 通知栏仍出现 "Agent at work" 常驻通知，进程不被冻结 |
| G5 | 不引入新依赖，不改 Hermes 服务端协议 | `package.json` 无新增运行时依赖 |

## 非目标

- 不重构保活整体架构（不引入 WorkManager / AlarmManager / bindService 方案）
- 不改 Android 通知渠道命名与通知 ID
- 不处理 Android 15 dataSync 6 小时上限本身（已有 `onTimeout` 兜底，本次只保证超时后不崩）

## 约束

- 必须遵守项目 `AGENTS.md`：测试用例先于交付，`npm test` 全绿才允许提交
- 必须遵守 `handbook/workflow.md`：Phase 1 设计审查通过后才进 Phase 2
- 分支统一在 `main`，版本号延续 `1.8.3-preview.x`
