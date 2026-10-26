# 测试方案（v2）

## 一、分层策略

| 层 | 工具 | 覆盖范围 | 是否可在 CI 跑 |
|----|------|---------|--------------|
| L1 纯逻辑单测 | vitest（真实 import 生产代码） | `keepAlivePolicy.ts` 的冷却与退避算法 | ✅ 可 |
| L2 源码静态门禁 | `scripts/verify-fixes.mjs`（真实 `fs.readFileSync` 读源码） | `onStartCommand` 内 `startForeground` 下标必须最先；catch 内不含 `stopSelf`；看门狗内无 stop 动作；`start()` 的 preflight 顺序；`TurnEffects` 裂脑分支已修；`canStartNow`/`nextBackoffMs` 真实被调用 | ✅ 可 |
| L3 真机验证 | 手动 | 通知出现、后台不被冻结、连续开关不闪退 | ❌ 不可（需真机，由用户执行） |

### 已删除的 v1 错误做法

v1 的「L3 状态机推演单测」在测试文件里自己实现一遍状态迁移再做断言 —— 那是**循环自证**，直接违反 `AGENTS.md` 的测试铁律，v2 删除。可测的逻辑一律下沉到 `src/lib/keepAlivePolicy.ts` 由 vitest 真实 import；不可测的 Kotlin 生命周期行为由静态结构断言防护 + 真机验证兜底，并如实标注。

### 关于 Kotlin JVM 测试的取舍（重新评估后维持不新增，理由已修正）

v1 的理由（"没有测试源集所以不做"）不成立 —— 加两行 `testImplementation` 即可。真实成本在于：

1. `modules/hermes-keepalive` 是独立 Gradle 子工程，其 `test` 任务当前未接入 `npm test`，也未被 CI 调用；接进去要改 `.github/workflows/android.yml` 增加一次 `./gradlew :hermes-keepalive:test`。
2. 本变更的 Kotlin 改动全部是"调用顺序"与"不调用某方法"，属于结构约束而非算法，JUnit 也测不到 —— 除非把逻辑搬进可注入依赖的类，那是重构而非修复。

因此维持"不新增 Kotlin 测试源集"，但把可算法化的部分（冷却、退避）**搬到了 TS 层**，由 vitest 真测。这个取舍写进 `summary.md` 的遗留问题。

## 二、用例清单

见 `test-cases.md`。

## 三、通过标准（实数校准）

当前基线：vitest 7 个文件 / **49 项**用例；verify-fixes **22 项**套件。

| 项 | 门禁 |
|----|------|
| `npx tsc --noEmit` | 0 错误 |
| `node scripts/check-i18n.mjs` | 通过 |
| `npm test` 单元测试 | ≥ **71** 项（49 基线 + 19 项 keepAlivePolicy + 4 项下载新增 − 1 项已删除） |
| `npm test` verify-fixes | ≥ **23** 项（22 基线 + 1 项 KeepAlive 结构断言套件） |
| L3 真机项 | 交付说明中如实标注"待用户验证"，不得写成已通过 |

## 四、回归关注点

| 关注点 | 检查方式 |
|--------|---------|
| 下载链路不被破坏 | `tests/download.test.ts` 18 项全绿 |
| 指标格式化不被破坏 | `tests/metrics.test.ts` 全绿 |
| 会话删除 RPC 契约 | verify-fixes Test 20 |
| SAF 落盘契约 | verify-fixes Test 21 |
| 已保存态不退回下载 | verify-fixes Test 22 |
| 通知常量未被改动 | verify-fixes 新增套件内断言 |
