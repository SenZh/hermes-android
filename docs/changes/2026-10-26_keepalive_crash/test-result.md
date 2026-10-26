# 测试执行结果

## 一、执行环境

| 项 | 值 |
|----|----|
| 执行时间 | 2026-10-26 15:2x UTC |
| 命令 | `npx tsc --noEmit` / `node scripts/check-i18n.mjs` / `npm test` |
| 工具链 | vitest 5.0.5 + node（verify-fixes.mjs） |
| Android 编译 | **未执行**（本机无 `ANDROID_HOME` / gradle / kotlinc） |

## 二、汇总

| 总用例数 | 通过 | 失败 | 跳过 | 通过率 |
|---------|------|------|------|-------|
| 86（63 vitest + 23 verify 套件） | 86 | 0 | 0 | 100% |

| 门禁 | 结果 |
|------|------|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `node scripts/check-i18n.mjs` | ✅ zh: ok |
| vitest 单元测试 | ✅ 8 文件 / 63 项通过 |
| verify-fixes 套件 | ✅ 23/23 通过（`ALL 23 SUITES PASSED (0 ERRORS)`） |

## 三、本轮新增/变更用例

| 用例 ID | 内容 | 结果 |
|--------|------|------|
| TC-KA-07 ~ 13、19 ~ 21 | `keepAlivePolicy` 冷却与退避（11 项，真实 import 生产代码） | ✅ |
| TC-DL-19 | 名字匹配优先于"新增条目"启发式 | ✅ |
| TC-DL-20 | 新增多个条目且名字对不上返回 null | ✅ |
| TC-DL-21 | 识别 picker 取消异常 | ✅ |
| TC-DL-22 | 真实错误不被误判为取消 | ✅ |
| TC-DL-15 | （已删除）SAF 自动改名场景在 `overwrite` 语义下不复存在，且与 TC-DL-19 的优先序冲突 | — |
| verify Test 23 | KeepAlive 结构断言 9 组（startForeground 顺序、catch 不 stop、看门狗不干预、preflight 先于投递且失败即返回 false、OnDestroy 不停服、JS 冷却/退避接线、裂脑分支、stop 延后、通知常量） | ✅ |

## 四、失败用例分析

| 用例 | 失败原因 | 根因 | 是否修复 |
|------|---------|------|---------|
| TC-DL-15（首轮） | `expected undefined to be 'app (1).apk'` | 用例构造的场景（同名旧文件消失 + 新增两个文件）在现实中不成立；实现已改为名字匹配优先，该启发式只在名字完全对不上时兜底 | ✅ 用例删除，保留 TC-DL-19/20 覆盖真实语义 |
| verify Test 23 第 6 组（首轮） | `backoff gate must be wired before KeepAlive.start` | 断言找的是 `nextBackoffMs(` 的首次出现，但它只在失败分支被调用（位于 start 之后）；真正的前置门是 `now < retryAfter` | ✅ 断言改为检查 `now < retryAfter` 位置 + `nextBackoffMs(failStreak)` 确有调用 |
| verify Test 23 第 8 组（首轮） | `stop() must defer while a start is still in flight` | 实现改用 `requestStop()`（时间戳方案），断言还在找旧的布尔字段名 | ✅ 断言同步为新 API |

## 五、未执行项（诚实声明）

| 项 | 原因 | 谁执行 |
|----|------|-------|
| Kotlin 编译 | 本机无 Android SDK / gradle / JDK | CI（push 后自动构建 APK 时验证） |
| L3 真机：通知出现、后台不被冻结、连点开关不闪退 | 无真机 | 用户 |
| H1 落盘行为（选目录 → 首次下载 → 是否报错） | 无真机 | 用户 |

## 六、明确不能声称的结论

- 不能声称"Kotlin 改动编译通过" —— 未经编译。
- 不能声称"闪退已修复并经真机验证" —— 只有静态与逻辑层证据。
- 不能声称"下载覆盖与重进识别已修复" —— H1 的根因（伪子 URI）已按 AOSP 语义修正为 `copy(Directory)`，但真机行为未验证。
