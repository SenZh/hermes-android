# Phase 2 测试审查报告

审查对象：`a5681b2`（HEAD，工作区干净）中 KeepAlive 前台服务崩溃修复 + 下载落盘修复的测试资产。
审查基准：`contract.md`(C1-C9/B1-B10/A1-A7/N1-N3)、`test-cases.md`、`test-plan.md`、`test-result.md`、`code-review.md`。
审查方式：实跑 `npx tsc --noEmit` / `node scripts/check-i18n.mjs` / `npm test`；并把 `scripts/verify-fixes.mjs` + 被测源码复制到隔离目录 `$TMP/gate/tree`，对源码做**内存级变异**（不修改仓库文件）后重跑同一套断言，用"门禁是否仍全绿"判定断言强度。

## 〇、实跑数字复核（先给结论）

| 项 | test-result 声称 | 实测 | 一致性 |
|----|-----------------|------|--------|
| vitest | 8 文件 / 63 项 | `Test Files 8 passed (8)` / `Tests 63 passed (63)` | ✅ |
| verify-fixes | 23/23 | `ALL 23 SUITES PASSED (0 ERRORS)`，exit 0 | ✅ |
| 总数 | 86 全绿 | 63 + 23 = 86，全绿 | ✅ 数字本身真实 |
| `npx tsc --noEmit` | 0 错误 | exit 0，无输出 | ✅ |
| `node scripts/check-i18n.mjs` | zh: ok | `[i18n] zh: ok` | ✅ |

**数字真实，但"86 项全绿"的含金量被高估**：verify-fixes 的 23 个套件里，Test 1–20 共 20 个套件**不读取任何生产源码**（详见维度二、三），真正接触被测代码的只有 Test 21/22/23 三个。有效门禁 ≈ 63 + 3。

## 一、契约覆盖度逐条对照

判定口径：**已覆盖**＝存在可执行断言且能拦住语义反转；**部分覆盖**＝仅文本存在性/顺序，语义可绕；**未覆盖**＝无断言或断言可被日常改动绕过（附实测变异编号）。

### 1.1 主路径 C1-C9

| # | 契约要求 | 对应断言 | 结论 | 依据 / 后果 |
|---|---------|---------|------|------------|
| C1 | `onStartCommand` 内 `startForeground` 下标最小 | `verify-fixes.mjs:606-614` | 部分覆盖 | 纯文本 `indexOf` 比较。M3（`"stopSelf()"` 写进字符串 + 真实停服走 `stopQuietly()`）、M4（`if (Build.VERSION.SDK_INT >= 99) { startForeground… }`）均全绿；M18（真的把 `stopSelf()` 提到前面）能拦住。**只防字面量顺序，不防执行顺序** |
| C2 | 成功路径把 `state` 置 `RUNNING` | 无 | **未覆盖** | M10 删除 `KeepAliveService.kt:49` 的 `state = ServiceState.RUNNING` → 23 套件全绿。后果：模块 `update()` 会永远看到 STARTING，通知文本永不刷新 |
| C3 | `ensureChannelReady` 在投递前，false 即 return false | `verify-fixes.mjs:632-643` | 部分覆盖 | 顺序 + `return@Function false` 的正则能拦住 M1（去掉 `!`）；但 **M2 把 `KeepAliveService.kt:191` 的 `!= null` 改成 `== null`（preflight 永远 false，服务永不启动）全绿**——语义无人守 |
| C4 | 投递后 `armWatchdog()` 被调用，`WATCHDOG_MS = 4000L` | 无 | **未覆盖** | `armWatchdog` 在代码中根本不存在（`grep` 为 0 命中，`HermesKeepAliveModule.kt:61-62` 是内联 `handler.postDelayed`），契约写的是已废弃的设计词。M9 把 `WATCHDOG_MS` 改 60000L 全绿。后果：看门狗失效无人发现 |
| C5 | 看门狗内不含 `stopService`/`stopSelf`，仅改 `state` 与 `lastStartMissedAt` | `verify-fixes.mjs:625-630` | 部分覆盖 | 只查两个字面量。M6b 让看门狗调 `shutdown()`（内部 `context.stopService`）全绿；`lastStartMissedAt` 的赋值无断言 |
| C6 | 裂脑分支 `KeepAlive.stop()` 先于 `running = false` | `verify-fixes.mjs:659-666` | 已覆盖 | 切片内真实下标比较，逻辑成立（`TurnEffects.tsx:118-119`） |
| C7 | `sync()` 在 `KeepAlive.start` 前真实调用 `canStartNow` | `verify-fixes.mjs:651-655` | 部分覆盖 | 只比下标不比极性。**M7 把 `TurnEffects.tsx:128` 的 `if (!canStartNow(...))` 改成 `if (canStartNow(...))`（冷却门反向：冷却期内投递、冷却期外拒绝）全绿** |
| C8 | `sync()` 在 `KeepAlive.start` 之前调用 `nextBackoffMs` 作为退避门 | `verify-fixes.mjs:656` | **契约失真** | 实现里 `nextBackoffMs(failStreak)` 在 `TurnEffects.tsx:144`，位于 `KeepAlive.start`（:136）**之后**；真正的前置门是 `now < retryAfter`（:135）。测试按实现改了断言，但 **contract.md 仍保留旧措辞且状态列仍是"待验"**。M8（`now > retryAfter`）能拦住字面量反转，但契约与实现两份文档已互相矛盾 |
| C9 | 模块 `OnDestroy` 内不再 `stopService` | `verify-fixes.mjs:645-648` | 已覆盖（但切片过宽） | `onDestroyBody` 从 `OnDestroy {` 切到 `private companion object`，把 OnDestroy 之后的所有代码都吃进来（M6 的 helper 就是被这条误捕的），定位不准但方向正确 |

### 1.2 边界/异常 B1-B10

| # | 触发条件 → 预期 | 对应断言 | 结论 | 依据 / 后果 |
|---|----------------|---------|------|------------|
| B1 | 首次 `startForeground` 抛异常 → 兜底再调一次，不 stopSelf | `verify-fixes.mjs:616-623` | 部分覆盖 | 断言"catch 内 `startForeground` ≥1 次且无 `stopSelf`"，挡住 M 系列的直接写法；但 `test-cases.md:8` 写的是"≥2 次"，实现是 `>=1`，文档与实现不一致 |
| B2 | 4s 后仍 STARTING → 只置 UNCONFIRMED + 记录时刻 | `verify-fixes.mjs:625-630` | 部分覆盖 | 只验 `UNCONFIRMED` 存在；`lastStartMissedAt` 与"4s 窗口"均无断言（同 C4） |
| B3 | RUNNING 时看门狗不改状态 | 无 | **未覆盖** | `test-cases.md:12` 明确要求"检查 Runnable 内有 `state == STARTING` 守卫"，**实际断言没有这条**。M5 删掉 `HermesKeepAliveModule.kt:26` 的守卫（无条件置 UNCONFIRMED）→ 全绿。后果：正在工作的服务每秒被误判为 UNCONFIRMED |
| B4 | stop 后 <300ms 不投递 | vitest `TC-KA-07`（`tests/keepAlivePolicy.test.ts:7-10`）+ `verify-fixes.mjs:653` | 部分覆盖 | 纯函数层已覆盖；接线层可被 M7 反向 |
| B5 | stop 后 ≥300ms 允许 | `tests/keepAlivePolicy.test.ts:12-15` | 已覆盖 | 含 1199/1200 精确边界 |
| B6 | 连续 1→5 次失败退避 1000/2000/4000/8000/16000 | `tests/keepAlivePolicy.test.ts:41-47` | 已覆盖 | 真实 import，逐值断言 |
| B7 | ≥6 次封顶 30000 | `:49-53` | 已覆盖 | 6/20/99 三档 |
| B8 | `failStreak = 0` 返回 0 | `:55-58` | 已覆盖 | 含 -1 |
| B9 | `lastStopAt = 0` 允许 | `:17-20` | 已覆盖 | 含 -1 |
| B10 | 通道不可用 → 不投递 | `verify-fixes.mjs:640-643` | 部分覆盖 | 只验 `start()` 侧 return false 结构；`ensureChannelReady` 本体语义可反（M2） |

### 1.3 相邻影响 A1-A7

| # | 范围 | 结论 | 依据 |
|---|------|------|------|
| A1 | 下载链路全绿 | 已覆盖（数字漂移） | 实测 `tests/download.test.ts` **21 项**，非文档写的 18 项 |
| A2 | 指标格式化 | 已覆盖 | `tests/metrics.test.ts` 4 项通过 |
| A3 | SAF 落盘契约 | **部分覆盖（可绕）** | Test 21 全部是 `viewer.includes('字面量')`。**M13 把 `viewer.tsx:344` 的 `pickCreatedEntry(...)` 换成 `null`**（真实 URI 永不认领＝H1 根因复发）→ 全绿。`pickCreatedEntry` 的存在只由 import 行满足 |
| A4 | 已保存态不退回下载 | **自相矛盾** | `verify-fixes.mjs:560-569` 断言 `degraded` 记录与 `downloadRecord && downloadRecord.targetUri ?` 字面量存在，消息写 "never silently drop it back to the Download button"；但 `viewer.tsx:401` 正是这个条件——degraded 后 `targetUri=''`，条件为假，**按钮确实退回"下载"**。断言在证明与它自己文字相反的代码 |
| A5 | 会话删除 RPC 契约 | **假覆盖** | Test 20（`verify-fixes.mjs:502-511`）断言的是脚本内手写的对象字面量 `{ session_id, profile }`，与 `src` 零关系。**M20 把 `src/app/(tabs)/sessions.tsx:163` 的 `rpc().request('session.delete', …)` 改回 `/api/sessions/bulk-delete` → 门禁全绿** |
| A6 | 通知常量 | 已覆盖 | `verify-fixes.mjs:680-683`（9119 / hermes-working / IMPORTANCE_LOW） |
| A7 | 无旁路投递 | **未覆盖** | `test-cases.md:24` 承诺的 `grep startForegroundService` 从未实现。本次人工核查结果：生产代码仅 `HermesKeepAliveModule.kt:60` 一处（其余为注释/`build/` 产物），当前事实正确但没有门禁 |

### 1.4 未覆盖后果汇总

「C2 + C4 + B3 + A5 + A7 完全无断言」，「C1/C3/C5/C7/A3 只防字面量、语义可反转」——即：**本次修复的两条铁律（投递前不得停服、投递必须先提权）只在"文本相邻"层面被守住，任何一次合法的重构（抽方法、加条件、改返回语义、加字符串标记）都会让门禁绿而行为坏。**

## 二、维度审查结论

### 2.1 契约覆盖度
见上表。九条主路径里：已覆盖 2（C6、C9）、部分 5（C1/C3/C5/C7/C8）、未覆盖 2（C2、C4）。B 组十条里：已覆盖 5（B5-B9）、部分 4（B1/B2/B4/B10）、未覆盖 1（B3）。相邻 7 条里：已覆盖 3（A1/A2/A6）、部分 2（A3/A4）、假覆盖 1（A5）、未覆盖 1（A7）。**契约完成标准表里 C1-C9 的"结果"列全部仍是"待验"，test-result 未回填**——审查基线本身没闭环。

### 2.2 用例充分性
- `test-cases.md` 列 18 条 TC-KA，实现映射：TC-KA-03/04/05/07/08/09/10/11/12/13/15/16/17 有真实断言；**TC-KA-01 是空行**（前置/步骤/预期全为 `—`，`test-cases.md:7`）；**TC-KA-06 要求"检查 STARTING 守卫"未实现**（M5 证明）；**TC-KA-18 未实现**（见 A7）；TC-KA-14 的"`nextBackoffMs` 在 start 之前"与实现不符。
- **写了但没实现**：TC-KA-01、TC-KA-06 关键项、TC-KA-18。
- **实现了但文档没有**：`TC-KA-19/20/21`（`tests/keepAlivePolicy.test.ts:31,35,68`）、`TC-KA-13b`；**`TC-DL-01~22` 共 21 条全部未进 `test-cases.md`**，只在 `test-result.md` 里出现 4 条。
- **边界值**：`keepAlivePolicy` 侧做得扎实（1199/1200 精确边界、0/-1/NaN/Infinity/超大体量、自定义 base/cap、时钟回拨）。缺口：`canStartNow(NaN, …)`、`canStartNow(1000, NaN)` 未测；`download` 侧 `calculateDownloadSpeed` 的 NaN/Infinity 入参、`resolveFileNameConflict` 空文件名、`pickCreatedEntry` 中 `after` 出现同名重复条目、`safeParseDownloadRecord('[]')`（数组）均未覆盖。这些不是致命项，但"边界值都测了"的说法不成立。

### 2.3 测试真实性（循环自证）
- **`tests/*.test.ts` 无自证问题**：`keepAlivePolicy.test.ts:4`、`download.test.ts:4-11` 都真实 `import @/lib/...`，测试文件内没有重写业务逻辑。这一块比 v1 有实质进步（`test-plan.md:11-13` 声明的删除动作已落实）。
- **`verify-fixes.mjs` 的 Test 1–20 全部仍是自证，且本轮未修**：
  - Test 1 `verify-fixes.mjs:9-33`：在脚本里硬编码 `rawProviders` 数组，再用脚本内写的 `filter` 规则断言该数组——被测 `ModelPicker/ModelChooser` 从未打开。
  - Test 2 `:39-80`：脚本内自带 `normalizeAndVerify` 实现，断言自己；生产侧 `src/lib/` 里根本没有同名函数可对照。
  - Test 20 `:502-511`：断言一个手写对象，`assert.ok(obj.session_id)` 恒真，**M20 实证改坏生产代码仍全绿**。
  - Test 9 `:216-248`（SAF 落盘）、Test 12 `:296-311`（选区）、Test 18 `:444-474`（权限）、Test 19 `:477-500`（OOM）同属"重写逻辑再自证"。
  - 结论：`AGENTS.md` 的"严禁在测试文件内手写 mock 假函数然后测试假函数"在 `verify-fixes.mjs` 里被大面积违反，本轮只把 Test 23 做成了读源码，**旧债一笔未还**。
- **Test 21/22/23 读的是生产源码**（`fs.readFileSync`），方向正确；但 21/22 停在"字面量存在"层（M12b/M13 全绿证明），23 停在"文本下标"层（M2/M3/M4/M5/M6b/M7 全绿证明）。

### 2.4 门禁可绕过性（实测，逐条回答任务点名的三种构造）

| 构造 | 现有断言能否拦住 | 说明 |
|------|----------------|------|
| `if (!KeepAliveService.ensureChannelReady(context))` → 去掉 `!` | **能拦住**（M1 CAUGHT） | `verify-fixes.mjs:641` 的正则强制 `!\s*…` |
| `ensureChannelReady` 内部语义反转（`!= null` → `== null`），守卫字面量不变 | **拦不住**（M2 BYPASS） | 只查调用 shape，不查被调方语义 |
| 给 `startForeground` 加前缀 / 用条件包住（`if (SDK_INT >= 99) { startForeground… }`） | **拦不住**（M4 BYPASS） | `indexOf` 只算文本位置，不算执行顺序；改成 `startForegroundDelayed` 这类前缀会被 `indexOf('ServiceCompat.startForeground')` 当子串命中 |
| 把 `stopSelf()` 写进字符串字面量、真实停服走 `stopQuietly()` | **拦不住**（M3 BYPASS） | 断言 `atStopSelf = body.indexOf('stopSelf()')` 被字符串满足，`atForeground < atStopSelf` 成立 |
| 看门狗通过 helper 调 `stopService` | **拦不住**（M6b BYPASS） | 只查两个字面量在 `watchdogBody` 里出现与否 |
| `stopOrDefer()` 改成无条件 `stopSelf()`（本次崩溃的原始形态） | **拦不住**（M17 BYPASS） | Test 23 完全没切 `stopOrDefer`/`onTimeout`/`onTaskRemoved` |
| 反转冷却门 `!canStartNow` → `canStartNow` | **拦不住**（M7 BYPASS） | 只比下标 |
| 反转退避门 `now < retryAfter` → `now > retryAfter` | 能拦住（M8 CAUGHT） | 字面量匹配 |
| `WATCHDOG_MS` 4000→60000 | **拦不住**（M9 BYPASS） | 无断言 |
| 删除成功路径 `state = RUNNING` | **拦不住**（M10 BYPASS） | 无断言 |
| 退避唤醒 timer 删除（I3 复发） | **拦不住**（M15 BYPASS） | 无断言 |
| 三个共享时间戳移回 effect 内（I4 复发） | **拦不住**（M14 BYPASS） | 无断言 |
| `pickCreatedEntry` 不调用（H1 根因复发） | **拦不住**（M13 BYPASS） | 仅 import 行满足 |

判定：Test 23 是**"字面量存在性 + 文本顺序"门禁**，对"抽方法 / 加条件 / 改语义 / 换实现"四类正常重构全部失效。它拦得住「复制粘贴式的倒退」，拦不住「有意的或重构引入的语义反转」。

### 2.5 数字自洽性
86 = 63 + 23 实测成立（见第〇节）。但门槛表与实测的分类口径有漂移：
- `test-plan.md:36` 称 vitest "49 基线 + 11 + 4 − 1 = 63"；实测 63 对得上，但 `A1`/`test-plan.md:44` 写 download 18 项，实测 **21** 项。
- `test-cases.md:30` 称纯逻辑 7 项，实测 `keepAlivePolicy.test.ts` **11** 个 `it()`（含 TC-KA-13b）。
- `test-cases.md:31` 称静态 11 项，实际 Test 23 只有 9 组断言（TC-KA-02~06 + 14~18 应为 10 条）。
- `test-result.md:29` 用 "TC-KA-07 ~ 13、19 ~ 21" 描述 11 项，该区间只有 10 个 ID。
- `package.json` 的 `test` = `vitest run && node scripts/verify-fixes.mjs`，**不包含 tsc 与 i18n**；`test-plan.md:32-33` 把它们列为门禁，但未接入 `npm test`，CI 是否执行需另行确认（`code-review.md` 未提）。

结论：总数不假，但"分层用例数"这套账对不上，说明 `test-cases.md`/`test-plan.md` 是事后写的，不是先写的（与 `AGENTS.md` 的"测试用例先于交付"精神相反）。

### 2.6 未覆盖风险的如实性
`test-result.md` §五 列了 3 项（Kotlin 编译、L3 真机、H1 落盘），**遗漏了本轮改动里风险最高的几处**：
1. `stopOrDefer()` / `onTimeout` / `onTaskRemoved` 三条停服路径（`KeepAliveService.kt:88-113`）——无任何断言，且其中一条正是崩溃源头（M17 全绿）。
2. `Function("update")` 的 IDLE/STARTING 分支语义（`HermesKeepAliveModule.kt:74-88`）——M19 把 STARTING 改成返回 false（JS 在待决提权窗口内停服＝崩溃路径）全绿，未被列为未验项。
3. JS 侧的 I3（退避唤醒 timer）与 I4（时间戳提到模块作用域）——`code-review.md` 把 I4 标为"高"，但这两个修复连静态断言都没有（M14/M15 全绿），§五 未提。
4. `ensureChannelReady` 的返回语义（AOSP O 分支 `return true` 与 :191 的判空）——未验未声明。
5. `verify-fixes.mjs` Test 18 的断言写在 `.then` 里**没有被 await**，`ALL 23 SUITES PASSED`（:713）在断言结算前就打印。实测把断言改成必失败后：先打印 `ALL 23 SUITES PASSED`，再靠 unhandledRejection 以 exit 1 收场——报告里读到的"通过"字样可能是提前打印的。
6. §六 三条"不能声称"写得好，但缺一条最关键的：**"Test 23 只能证明字面量顺序，不能证明不被间接调用绕过"，这一点必须写进交付说明**，否则"结构断言防护"会被误读为"行为已验证"。

## 三、问题清单

| # | 类型 | 问题描述 | 引用位置 | 严重度 | 解决建议 |
|---|------|---------|---------|--------|---------|
| 1 | 门禁可绕 | `stopOrDefer()` 改成无条件 `stopSelf()`（本次崩溃的原始形态）后 23 套件全绿 | `KeepAliveService.kt:107-113`；Test 23 无该函数切片 | 严重 | 为 `stopOrDefer`/`onTimeout`/`onTaskRemoved` 各切一段断言：STARTING 时只能 `requestStop()`，禁止 `stopSelf()` |
| 2 | 循环自证 | Test 1–20 不读任何生产源码，全在脚本内重建逻辑再断言自己 | `scripts/verify-fixes.mjs:6-511` | 严重 | 删除或改造为 `readFileSync` 断言 + 纯逻辑下沉到 `src/lib/` 由 vitest 真实 import |
| 3 | 假覆盖 | A5 会话删除 RPC：Test 20 断言手写对象；M20 把 `sessions.tsx` 改回 `bulk-delete` 仍全绿 | `verify-fixes.mjs:502-511`；`src/app/(tabs)/sessions.tsx:163` | 严重 | 改为读 `sessions.tsx`/`SessionMenu.tsx` 断言 `'session.delete'` 出现且 `bulk-delete` 不出现 |
| 4 | 语义无守 | `ensureChannelReady` 返回语义反转（`!= null`→`== null`）全绿，preflight 永远 false | `KeepAliveService.kt:191`；`verify-fixes.mjs:640-643` | 严重 | 把"通道可用判定"下沉为纯函数（入参 `channelExists: boolean`）由 vitest 真测 |
| 5 | 契约未覆盖 | C2 无断言：删除成功路径 `state = RUNNING` 全绿 | `KeepAliveService.kt:49` | 高 | Test 23 增组：成功 try 块内 `state = ServiceState.RUNNING` 必须存在且位于 `startForeground` 之后 |
| 6 | 契约未覆盖 | C4 措辞指向不存在的 `armWatchdog`；`WATCHDOG_MS` 改 60000 全绿 | `contract.md:10`；`HermesKeepAliveModule.kt:62,112` | 高 | 修订契约为 `handler.postDelayed(watchdog, WATCHDOG_MS)`；断言 `WATCHDOG_MS = 4000L` 且 postDelayed 存在 |
| 7 | 门禁可绕 | 看门狗 `state == STARTING` 守卫（B3/TC-KA-06）无断言，删除后全绿 | `HermesKeepAliveModule.kt:26`；`verify-fixes.mjs:625-630` | 高 | 断言 `watchdogBody` 含 `ServiceState.STARTING` 守卫 + `lastStartMissedAt` 赋值 |
| 8 | 门禁可绕 | 看门狗经 helper 调 `stopService` 全绿 | `verify-fixes.mjs:628-629` | 高 | 除字面量外，断言 `watchdogBody` 里 `stop`/`kill`/`shutdown` 类标识符一律为 0（白名单法） |
| 9 | 门禁可绕 | 冷却门极性反转（`!canStartNow`→`canStartNow`）全绿 | `TurnEffects.tsx:128`；`verify-fixes.mjs:653-655` | 高 | 断言正则必须含 `if (!canStartNow(`（带 `!`），并断言其后紧跟 `return`/`setTimeout` |
| 10 | 门禁可绕 | `startForeground` 被条件包住/改前缀全绿 | `verify-fixes.mjs:606-614` | 高 | 断言首个 `startForeground` 调用所在语句块无前置 `if (`；或用轻量正则校验 `try {` 后第一条语句即该调用 |
| 11 | 门禁可绕 | `stopSelf()` 写进字符串字面量可满足下标断言 | `verify-fixes.mjs:611-613` | 高 | 先剥离字符串字面量（配合已有 `stripComments`）再比下标 |
| 12 | 契约失真 | C8：实现中 `nextBackoffMs` 在 `start` 之后，测试按实现改了断言，契约仍旧措辞且状态"待验" | `contract.md:14`；`TurnEffects.tsx:135,144`；`verify-fixes.mjs:656` | 高 | 修订 contract.md C8 为"`now < retryAfter` 门在 start 之前 + `nextBackoffMs` 真实参与计算"，并回填 C1-C9 结果列 |
| 13 | 门禁缺失 | I3/I4（自审标为中/高的 JS 修复）零断言：删退避 timer、把共享时间戳移回 effect 内均全绿 | `TurnEffects.tsx:83-85,147-148` | 严重 | 抽 `src/lib/keepAliveScheduler.ts`（退避下一次唤醒时间 + 跨挂载共享时间戳），vitest 真测；断言三个 `let` 位于 `useEffect` 之外 |
| 14 | 门禁可绕 | A3：`pickCreatedEntry` 调用改成 `null`（H1 根因复发）全绿，只由 import 行满足 | `viewer.tsx:344`；`verify-fixes.mjs:542-546` | 高 | 断言 `pickCreatedEntry(beforeNames, after, finalTargetName)` 完整调用表达式，且 `realUri` 确实写入 `record.targetUri` |
| 15 | 断言与语义相反 | A4：degraded（`targetUri=''`）后 `viewer.tsx:401` 条件为假 → 按钮确实退回"下载"，与断言消息相反 | `verify-fixes.mjs:560-569`；`viewer.tsx:401,439,458` | 中 | 二选一：改文案与断言（承认降级即退回下载），或改 `headerRight` 判据为 `downloadRecord` 非空并给出"打开所在目录"入口 |
| 16 | 用例未实现 | TC-KA-01 是空行（预期结果 `—`），C3 正向路径无任何断言 | `test-cases.md:7` | 中 | 删除该行或在 `ensureChannelReady` 下沉后补正向用例 |
| 17 | 用例未实现 | TC-KA-18/A7 承诺的 `grep startForegroundService` 从未实现 | `test-cases.md:24` | 中 | 在 Test 23 加目录遍历断言：`modules/`+`src/` 的 `.kt/.ts/.tsx` 中该符号仅 1 处（排除注释与 `build/`） |
| 18 | 文档漂移 | TC-KA-19/20/21、TC-KA-13b、TC-DL-01~22 已实现但清单缺失；test-cases 分层计数与实际不符（7/11、11/9） | `test-cases.md:26-31`；`test-result.md:29` | 低 | 用脚本从测试文件抽取用例 ID 反向生成清单，避免手抄 |
| 19 | 计数漂移 | A1/`test-plan.md:44` 称 download 18 项，实测 21 项 | `contract.md:36`；`test-plan.md:44` | 低 | 更正为实测数字并写明统计时刻 |
| 20 | 门禁时序 | Test 18 断言在 `.then` 内未 await，`ALL 23 SUITES PASSED` 先于断言结算打印（实测：断言必失败时仍先打印 PASSED，靠 exit 1 兜底） | `verify-fixes.mjs:444-474,713` | 中 | `runAll` 改 async，逐个 `await`；最后一行 PASSED 放到全部结算之后 |
| 21 | 断言定位 | C9 的 `onDestroyBody` 切片从 `OnDestroy {` 到 `private companion object`，把 OnDestroy 之后的所有成员都算进来（误捕/漏辨风险） | `verify-fixes.mjs:645-648` | 低 | 用括号配平切出 `OnDestroy {` 的真实块 |
| 22 | 如实性 | `test-result.md` §五 遗漏：`stopOrDefer`/`onTimeout`/`onTaskRemoved`、`update()` 分支语义、I3/I4、`ensureChannelReady` 语义、`tsc`/i18n 是否进 CI；§六 未声明"静态断言仅文本顺序、可被间接调用绕过" | `test-result.md:45-57` | 中 | 补齐未执行项；§六 增一条"静态门禁不证明运行时行为，且不防间接调用" |
| 23 | 门禁未接入 | `npm test` 只跑 vitest + verify-fixes，`tsc`/i18n 需手工执行 | `package.json` scripts | 低 | 把 `tsc --noEmit`、`check-i18n.mjs` 串进 `test`，或加独立 `verify` 脚本并在 CI 调用 |

**严重度分布**：严重 5（#1/#2/#3/#4/#13）、高 9（#5-#12/#14）、中 5（#15/#16/#17/#20/#22）、低 4（#18/#19/#21/#23）。

### 做得对、明确不计入问题的部分
- `tests/keepAlivePolicy.test.ts`、`tests/download.test.ts` 真实 import 生产模块，无自证；边界值（精确 300ms 边界、0/-1/NaN/Infinity、自定义 base/cap、时钟回拨）覆盖到位。
- Test 23 的 `stripComments` 前置处理是有意识的反作弊设计（`verify-fixes.mjs:585-590`），确实消除了"一行注释骗过断言"这类低级绕过。
- `test-result.md` §六"不能声称的结论"三条写得诚实，未把静态证据包装成行为已验证。
- 本轮实跑 63+23 全绿、tsc 0 错误、i18n 通过 —— 从"代码当下是好的"这个意义上，证据成立；问题在**门禁对未来回归的拦截力**。

## 四、准入建议

**驳回（要求补充测试后重审）。**

理由不是"用例全绿是假的"，而是三条硬伤：

1. **本次崩溃的核心不变量无门禁**：`stopOrDefer()` 恢复成无条件 `stopSelf()`（#1，M17 实证全绿），等于"这次修的 Bug 可以在无人察觉的情况下被改回来"，而 `AGENTS.md` 明文要求"每次 Bug 修复必须新增一个对抗该 Bug 的真实用例"。
2. **两条自审标为最高的 JS 修复零断言**（#13，M14/M15 实证全绿）：I4 的模块级时间戳与 I3 的退避唤醒是"重挂载即失效"的隐性回归点，无测试等于无修复证据。
3. **86 项中 20 项是自证**（#2/#3）：`verify-fixes.mjs` 的 Test 1–20 与 `AGENTS.md` 测试铁律直接冲突，且本轮明确"修了全部阻断项"却未动它们 —— 这属于把旧债当成已还。

放行前的最小必改集（按性价比排序）：
- **P0**：补 #1（`stopOrDefer`/`onTimeout`/`onTaskRemoved` 切片断言）、#13（抽 `keepAliveScheduler` 由 vitest 真测 I3/I4）、#3（Test 20 改为读生产源码）。
- **P1**：补 #5(C2)、#6(C4)、#7(B3)、#11（剥字符串字面量）、#14（A3 完整调用表达式）；修 #20（await）。
- **P2**：修订 contract.md 的 C4/C8 措辞并回填 C1-C9 结果列；`test-cases.md` 用脚本反向生成；#22 补齐未执行项。

补完 P0+P1 后，建议把 Test 23 的九组断言按"每个契约一条"重新编号并在报告里列 ID 到断言的映射，否则下一轮审查仍无法逐条对账。
