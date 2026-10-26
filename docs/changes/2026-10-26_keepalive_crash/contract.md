# 产出契约（v2）

## 一、主路径（二元条件）

| # | 完成标准 | 验证方式 | 结果 |
|---|---------|---------|------|
| C1 | `KeepAliveService.onStartCommand` 方法体内，`ServiceCompat.startForeground` 的字符下标 **小于** `stopSelf` 与 `ensureChannel` 的下标（即它最先出现） | `verify-fixes.mjs` 切出方法体后比 `indexOf` | 待验 |
| C2 | `onStartCommand` 首个 try 块成功路径将 `state` 置 `RUNNING` | 源码断言 | 待验 |
| C3 | `HermesKeepAliveModule.start()` 中 `ensureChannelReady` 下标 **小于** `startForegroundService` 下标，且其返回 false 时直接 return false（不投递） | 源码断言 | 待验 |
| C4 | `start()` 投递成功后 `armWatchdog()` 被调用，且 `WATCHDOG_MS = 4000L` | 源码断言 | 待验 |
| C5 | 看门狗 Runnable 内**不含** `stopService` / `stopSelf`，仅改 `state` 与 `lastStartMissedAt` | 源码断言 | 待验 |
| C6 | `TurnEffects.tsx` 的 `update()` 失败分支（原 `:100-104`）中，`KeepAlive.stop()` 出现在 `running = false` **之前** | 源码断言（取该 if 块切片比下标） | 待验 |
| C7 | `sync()` 在调用 `KeepAlive.start` 之前真实调用了 `canStartNow(...)` | 源码断言 `canStartNow(` 下标小于 `KeepAlive.start(` | 待验 |
| C8 | `sync()` 在调用 `KeepAlive.start` 之前真实调用了 `nextBackoffMs(...)` 作为退避门 | 源码断言 | 待验 |
| C9 | 模块 `OnDestroy` 内不再出现 `stopService` | 源码断言 | 待验 |

## 二、边界 / 异常（触发条件 + 预期行为）

| # | 触发条件 | 预期行为 | 覆盖用例 |
|---|---------|---------|---------|
| B1 | `startForeground` 首次抛异常（如 `BadNotificationForStartForeground`） | 用兜底通知**再调一次** `startForeground`，不 `stopSelf` | TC-KA-01 / TC-KA-02 |
| B2 | 投递后 4 秒 `state` 仍 `STARTING` | 看门狗仅置 `UNCONFIRMED` 并记录时刻，**不动服务生命周期** | TC-KA-05 |
| B3 | 服务已 `RUNNING` 时看门狗到期 | 看门狗不改任何状态 | TC-KA-06 |
| B4 | `stop()` 后 < 300ms 内请求 `start()` | `canStartNow` 返回 false，本轮不投递 | TC-KA-07 |
| B5 | `stop()` 后 ≥ 300ms 请求 `start()` | `canStartNow` 返回 true | TC-KA-08 |
| B6 | 连续 1→5 次失败 | 退避 1000 / 2000 / 4000 / 8000 / 16000 ms | TC-KA-09 |
| B7 | 连续 6 次以上失败 | 退避封顶 30000 ms | TC-KA-10 |
| B8 | `failStreak = 0` | `nextBackoffMs` 返回 0（不等待） | TC-KA-11 |
| B9 | `lastStopAt = 0`（从未停过） | `canStartNow` 返回 true | TC-KA-12 |
| B10 | 通道不可用 | `ensureChannelReady` 返回 false → `start()` 不投递 | TC-KA-13（静态断言 preflight 存在） |

## 三、相邻影响（不被改坏的范围）

| # | 范围 | 断言方式 |
|---|------|---------|
| A1 | 下载链路 18 项用例 | `tests/download.test.ts` 全绿 |
| A2 | 指标格式化用例 | `tests/metrics.test.ts` 全绿 |
| A3 | SAF 落盘契约 | verify-fixes Test 21 |
| A4 | 已保存态不退回下载 | verify-fixes Test 22 |
| A5 | 会话删除 RPC 契约 | verify-fixes Test 20 |
| A6 | 通知常量未被改动 | 源码断言 `NOTIFICATION_ID = 9119`、`CHANNEL_ID = "hermes-working"` |
| A7 | 无其它地方绕过本模块直接投递前台服务 | `grep -rn "startForegroundService" modules/ src/` 结果仅 1 处（模块内） |

## 四、明确不承诺的项（诚实性声明）

| # | 项 | 原因 |
|---|----|------|
| N1 | Kotlin 行为未经 JVM 自动化测试 | 仓库无 `modules/hermes-keepalive/android/src/test/` 源集，新增属独立工程改造，本变更不做。Kotlin 侧以静态结构断言防护，行为真机验证由用户执行 |
| N2 | 主线程被长时间阻塞导致的 `onStartCommand` 迟到 | 应用侧无合规手段可解；本变更只保证"不该投递时不投递"与"一投递就先提升前台" |
| N3 | Android 15 dataSync 6 小时限额本身 | 已有 `onTimeout → stopSelf` 兜底，且该路径不崩溃（F13） |
