# 测试用例清单

## 一、纯逻辑用例（vitest，真实 import `src/lib/keepAlivePolicy.ts`）

| 用例ID | 场景 | 类别 | 前置条件 | 测试步骤 | 预期结果 | 关联契约 |
|-------|------|------|---------|---------|---------|---------|
| TC-KA-01 | 通道可用时允许投递 | 正常 | `enterChannelReady` 逻辑不涉及本模块（由静态断言覆盖） | — | — | C3 |
| TC-KA-02 | 首次 `startForeground` 失败后走兜底 | 异常 | Kotlin 静态结构 | 断言首个 catch 块内 `startForeground` 出现 ≥2 次且无 `stopSelf` | 兜底重试存在 | B1 |
| TC-KA-03 | `onStartCommand` 中 `startForeground` 最先出现 | 正常 | 源码 | 切出方法体，比 `startForeground` / `stopSelf` / `ensureChannel` 下标 | `startForeground` 下标最小 | C1 |
| TC-KA-04 | `start()` preflight 先于投递 | 正常 | 源码 | 比 `ensureChannelReady` 与 `startForegroundService` 下标 | 前者在前，且 false 时 return | C3 |
| TC-KA-05 | 看门狗只上报不干预 | 异常 | 源码 | 切出 watchdog Runnable，检查是否含 `stopService`/`stopSelf` | 不含 | C5 / B2 |
| TC-KA-06 | 看门狗对 RUNNING 无动作 | 边界 | 源码 | 检查 Runnable 内有 `state == STARTING` 守卫 | 有守卫 | B3 |
| TC-KA-07 | 停服后 < 300ms 不允许启动 | 边界 | — | `canStartNow(1000, 900)` | `false` | B4 |
| TC-KA-08 | 停服后 ≥ 300ms 允许启动 | 边界 | — | `canStartNow(1200, 900)` | `true` | B5 |
| TC-KA-09 | 连续失败退避翻倍 | 正常 | — | `nextBackoffMs(1..5)` | 1000/2000/4000/8000/16000 | B6 |
| TC-KA-10 | 退避封顶 | 边界 | — | `nextBackoffMs(6)`、`nextBackoffMs(99)` | 均为 30000 | B7 |
| TC-KA-11 | 无失败不等待 | 边界 | — | `nextBackoffMs(0)`、`nextBackoffMs(-1)` | 均为 0 | B8 |
| TC-KA-12 | 从未停过服时可直接启动 | 边界 | — | `canStartNow(1000, 0)` | `true` | B9 |
| TC-KA-13 | 自定义冷却与基数 | 边界 | — | `canStartNow(150, 0, 100)` / `nextBackoffMs(3, 500, 2000)` | `true` / `2000` | B4/B6 |
| TC-KA-14 | `sync()` 真实调用冷却与退避 | 正常 | 源码 | 断言 `canStartNow(` 与 `nextBackoffMs(` 均出现在 `KeepAlive.start(` 之前 | 均在之前 | C7 / C8 |
| TC-KA-15 | 裂脑分支先 stop 再置 false | 异常 | 源码 | 切出 `update()` 失败分支，比 `KeepAlive.stop()` 与 `running = false` 下标 | stop 在前 | C6 |
| TC-KA-16 | 模块 `OnDestroy` 不再 stopService | 相邻 | 源码 | 切出 `OnDestroy` 块检查 | 不含 `stopService` | C9 |
| TC-KA-17 | 通知常量未被改动 | 相邻 | 源码 | 检查 `NOTIFICATION_ID = 9119`、`CHANNEL_ID = "hermes-working"` | 均存在 | A6 |
| TC-KA-18 | 无旁路投递 | 相邻 | 源码树 | `grep startForegroundService` 于 `modules/` 与 `src/` | 仅模块内 1 处 | A7 |

## 二、用例分布

| 层 | 用例数 | 执行方式 |
|----|-------|---------|
| vitest 纯逻辑（TC-KA-07 ~ 13） | 7 | `npm test` |
| verify-fixes 静态结构（TC-KA-02 ~ 06、14 ~ 18） | 11 | `npm test` |
| 真机（L3） | 3（通知出现 / 后台不冻结 / 连续开关不闪退） | 用户手动，如实标注待验 |
