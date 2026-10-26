# 技术设计（v2，按设计审查驳回意见重写）

## 修订说明

v1 被设计审查驳回（4.6/10，30 条发现）。核心错误在于：**把 `stopSelf()` / `stopService()` 当成"干净的退出"**。实际上按 F11，任何在 `startForeground()` 之前的 stop 动作都同构于本次崩溃路径。由此得出一条铁律：

> **进程内唯一能清除"悬空前台记账"的动作，就是 `startForeground()` 本身。**
> 因此在 `startForeground()` 成功之前，禁止出现任何 stop 动作。

v2 的全部设计围绕这条铁律重写。

## 一、方案环节可行性证明矩阵

| 步骤/修改点 | 核心动作 | 潜在假设 / 依赖前提 | 证明手段 | 证据来源 | 验证结论 | 备选预案 |
|:---|:---|:---|:---|:---|:---|:---|
| P1 | `start()` 投递前做 preflight：`ensureChannel()` 后校验 `getNotificationChannel(CHANNEL_ID) != null`，不通过则**直接返回 false，不投递** | 假设"不投递"等于"不记账"，从而彻底消除崩溃可能 | 官方文档 + AOSP 机制 | F1：崩溃判定绑定的是 `Context.startForegroundService()` 这一次投递；不投递则系统侧无 ServiceRecord 可判 | ✅ 证实可行 | channel 永久不可用时保活退化为"仅前台生效"，但不崩（可接受降级） |
| P2 | `onStartCommand` **首条语句**调用 `ServiceCompat.startForeground(...)`，`build()` 与它在同一个 `try` 内 | 假设 channel 已由 P1 保证就绪，`build()` 只是内存构造不会失败 | 源码分析 + F14 | `build()` 仅做 `NotificationCompat.Builder` 链式构造与 `PendingIntent.getActivity`（`KeepAliveService.kt:94-114`），无 IO；channel 由 P1 前置保证 | ✅ 证实可行 | 若 catch 命中，走 P3 兜底重试 |
| P3 | `startForeground` 抛异常时**不 `stopSelf()`**，改用预置兜底通知再试一次；仅当第二次仍失败才 `stopSelf()` 并落盘错误码 | 假设 `BadNotificationForStartForeground` 属同步 binder 异常可被 catch；兜底通知不含任何可能失败的构造 | F14 + 源码分析 | F14：同步 binder 调用异常可 catch；兜底通知仅用 `android.R.drawable` 系统资源 + 已存在 channel | ✅ 证实可行 | 二次仍失败属系统级不可用，此时无任何合规动作可选，`stopSelf()` 是唯一选择，概率极低并在代码注释中如实标注 |
| P4 | 看门狗**只上报不改生命周期**：4 秒后若 `state === STARTING`，仅记录并置 `UNCONFIRMED`，**不调用 stopService / stopSelf** | 假设不干预不会造成二次伤害 | 逻辑推演 + F11 | v1 的"看门狗 stopService"与 F11 同构，会把违规提前到 4 秒；不干预时若服务最终起来，系统自然清账 | ✅ 证实可行 | 服务始终未起来时系统按 F1 判定，应用侧无法挽救，只能靠 P1 让"不该投递时压根不投递"来规避 |
| P5 | JS 侧修复**第二条裂脑分支**（`update()` 返回 false 分支）：先 `stop()` 再置 `running = false` | 假设消除"服务已死但 JS 以为在跑"的裂脑 | 源码分析 | 设计审查指出 v1 定位错分支：`TurnEffects.tsx:86-90`（want=false）**已经**先 stop；真正的裂脑在 `:100-104` | ✅ 证实可行 | 若 stop 时服务已不在，`stopService` 为无害空操作 |
| P6 | stop 后 300ms 冷却才允许再次投递；冷却期内到达的 start 合并 | 假设紧邻的 stop→start 是 I1 触发点 | 官方文档 + 社区实证 | F11 的 AWS Amplify issue #1868 明确记录该时序会触发同一异常 | ✅ 证实可行 | 冷却仅延迟不丢弃；冷却期内只保留最后一次请求 |
| P7 | 把"是否允许投递 / 冷却判定 / 失败退避"抽成纯 TS 模块 `src/lib/keepAlivePolicy.ts`，JS 侧真实调用 | 假设策略可在 JS 层表达（只依赖时钟与计数器，与 Android API 无关） | 项目既有实践 | `src/lib/downloadManager.ts` + `tests/download.test.ts` 同模式已通过 18 项用例 | ✅ 证实可行 | 无 |
| P8 | Kotlin 侧不新增 JVM 测试源集，改用 `verify-fixes.mjs` 对源码做结构性断言 | 假设源码文本断言足以防回归 | 项目既有实践 | `verify-fixes.mjs` Test 21/22 已在用 `fs.readFileSync` + `includes`，22 套件通过 | ✅ 证实可行 | 若文本漂移，断言按"方法体切片"匹配而非全文 includes |
| P9 | 移除模块 `OnDestroy` 里的隐式 stopService，改为仅复位状态 | 假设模块销毁时不需要强制停服务（服务自有 `onTaskRemoved` / `onTimeout` 兜底） | 源码分析 | `HermesKeepAliveModule.kt:56-58` 是 F12 所述第二条 stop 通道；服务自身已有两条自停路径（`KeepAliveService.kt:52-66`） | ✅ 证实可行 | 若确需停，改由 JS 显式 `stop()` 并受 300ms 冷却约束 |

## 二、技术方案

### 2.1 KeepAliveService.kt —— 首行必提升，失败不 stop

```kotlin
override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
  // 铁律：startForeground 成功之前，禁止任何 stop 动作。
  // 系统对每次 startForegroundService() 记账，唯一能清账的动作就是 startForeground()。
  val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Hermes is working"
  val text = intent?.getStringExtra(EXTRA_TEXT) ?: ""
  try {
    ServiceCompat.startForeground(this, NOTIFICATION_ID, build(this, title, text), foregroundType())
    state = ServiceState.RUNNING
    return START_NOT_STICKY
  } catch (first: Exception) {
    // 第一次失败（典型：BadNotificationForStartForeground）—— 绝不能 stopSelf，
    // 那会把"未提升前台"变成既成事实。用不含任何自定义资源的兜底通知再试一次。
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, fallbackNotification(this), foregroundType())
      state = ServiceState.RUNNING
      lastStartError = "primary_failed_fallback_ok:${first.javaClass.simpleName}"
      return START_NOT_STICKY
    } catch (second: Exception) {
      // 两次都失败 = 系统级不可用，已无任何合规动作，只能停。
      lastStartError = "both_failed:${second.javaClass.simpleName}"
      state = ServiceState.IDLE
      stopSelf()
      return START_NOT_STICKY
    }
  }
}
```

`ensureChannel` 从 `onStartCommand` 移出（由 `start()` 的 preflight 保证），`fallbackNotification` 只用 `android.R.drawable` 系统资源。

### 2.2 HermesKeepAliveModule.kt —— preflight + 只上报不改生命周期

```kotlin
Function("start") { title: String, text: String ->
  val intent = Intent(context, KeepAliveService::class.java)
    .putExtra(KeepAliveService.EXTRA_TITLE, title)
    .putExtra(KeepAliveService.EXTRA_TEXT, text)
  // Preflight：通道不可用就根本不投递。不投递 = 系统不记账 = 不可能超时崩。
  if (!KeepAliveService.ensureChannelReady(context)) return@Function false
  try {
    KeepAliveService.state = ServiceState.STARTING
    ContextCompat.startForegroundService(context, intent)
    armWatchdog()
    true
  } catch (e: Exception) {
    KeepAliveService.state = ServiceState.IDLE
    false
  }
}

private val watchdog = Runnable {
  // 只上报，不停服务：startForeground 之前 stopService 与崩溃同构。
  if (KeepAliveService.state == ServiceState.STARTING) {
    KeepAliveService.state = ServiceState.UNCONFIRMED
    KeepAliveService.lastStartMissedAt = System.currentTimeMillis()
  }
}
```

`OnDestroy` 移除 `context.stopService(...)`（P9），仅复位状态。

### 2.3 JS 侧 —— 修正确的分支 + 冷却 + 退避

`TurnEffects.tsx` 的 `sync()`（关键差异已标注）：

```ts
if (!want) {
  if (running) KeepAlive.stop()
  running = false; shown = ''; lastStopAt = Date.now()      // ← 记录停服时刻
  return
}
if (running && !KeepAlive.update(title, text)) {
  KeepAlive.stop()                                          // ← 修复 :100-104 裂脑（v1 漏掉）
  running = false; shown = ''; lastStopAt = Date.now()
}
if (!running) {
  const now = Date.now()
  if (!canStartNow(now, lastStopAt)) return                 // ← 冷却期内不投递
  if (now < retryAfter) return                              // ← 退避期内不投递
  const ok = AppState.currentState === 'active' && KeepAlive.start(title, text)
  running = ok
  if (ok) { shown = label; failStreak = 0; retryAfter = 0 }
  else { failStreak += 1; retryAfter = now + nextBackoffMs(failStreak) }
}
```

`src/lib/keepAlivePolicy.ts`：

```ts
export const STOP_COOLDOWN_MS = 300

/** 停服后 300ms 内不允许重新投递：stopService 的销毁是异步的，
 *  紧邻的 startForegroundService 会与其交错并留下悬空的前台记账。 */
export function canStartNow(now: number, lastStopAt: number, cooldownMs = STOP_COOLDOWN_MS): boolean {
  if (lastStopAt <= 0) return true
  return now - lastStopAt >= cooldownMs
}

/** 连续失败后的重试等待时长；首次失败 1s，逐次翻倍，上限 30s，成功即清零。 */
export function nextBackoffMs(failStreak: number, base = 1000, cap = 30_000): number {
  if (failStreak <= 0) return 0
  return Math.min(base * 2 ** (failStreak - 1), cap)
}
```

### 2.4 不变项

- `ServiceState` 枚举保留，新增 `UNCONFIRMED` 一项（只用于上报，不参与生命周期决策）
- `NOTIFICATION_ID = 9119`、`CHANNEL_ID = "hermes-working"`、通知文案与优先级不动
- `update()` / `stop()` / `onTimeout()` / `onTaskRemoved()` 语义不变
- `foregroundServiceType="dataSync"` 与两项权限声明不动

## 三、产出契约

| 场景 | 完成标准（可证伪） | 验证方式 |
|------|-------------------|---------|
| 主路径 | `onStartCommand` 方法体内，首个 `startForeground` 的下标小于 `stopSelf` 与 `ensureChannel` 的下标 | 静态断言（方法体切片后比下标） |
| 主路径 | `start()` 中 `ensureChannelReady` 的下标小于 `startForegroundService`，且未通过时直接 return false | 静态断言 |
| 异常路径 | 首个 catch 块内不含 `stopSelf`，而是第二次 `startForeground` | 静态断言：catch 块内 `startForeground` 出现 ≥2 次 |
| 异常路径 | 看门狗 Runnable 内不含 `stopService` / `stopSelf` | 静态断言 |
| 异常路径 | 冷却 / 退避算法边界正确 | 纯函数单测 `canStartNow` / `nextBackoffMs` |
| 相邻影响 | 模块 `OnDestroy` 不再调用 `stopService` | 静态断言 |
| 相邻影响 | 下载与指标链路不受影响 | 既有 49 项单测 + 22 项 verify 套件全绿 |
