# Phase 2 代码审查

## 一、主 Agent 自审

### 1.1 设计审查四个必查点的落地自查

| # | 设计审查要求 | 实现位置 | 自查结果 |
|---|------------|---------|---------|
| 1 | `onStartCommand` 内 `startForeground` 下标小于 `stopSelf` 与 `ensureChannel` | `KeepAliveService.kt:44-52` | ✅ `startForeground` 在方法体第一段 try 的首行；`stopSelf()` 仅出现在 `catch (second)` 与 `stopRequested` 分支（均在 promotion 之后）；方法体内已无 `ensureChannelReady` |
| 2 | 首个 catch 块内不含 `stopSelf` | `KeepAliveService.kt:53-62` | ✅ 首个 catch 内是第二次 `startForeground(fallbackNotification)`，无 stop |
| 3 | 看门狗 Runnable 内不含 `stopService` / `stopSelf` | `HermesKeepAliveModule.kt:30-36` | ✅ 仅置 `UNCONFIRMED` 与 `lastStartMissedAt` |
| 4 | `sync()` 真实调用 `canStartNow` 与 `nextBackoffMs` 且下标在 `KeepAlive.start` 之前 | `TurnEffects.tsx:110-133` | ✅ `canStartNow`、`now < retryAfter` 均在 `KeepAlive.start` 之前；`nextBackoffMs(failStreak)` 在失败分支真实计算 |

### 1.2 自审发现的实现期问题（已当场修复）

| # | 问题 | 严重度 | 处理 |
|---|------|-------|------|
| I1 | **`stop()` 在 STARTING 窗口内直接 `stopService`，与设计铁律自相矛盾** —— 设计说"`startForeground` 成功前禁止任何 stop"，但 JS 的 stop 只受冷却保护，若 start 刚投递 4 秒内任务就结束，stop 会撞上未决的前台要求 | 高 | 已修：模块 `stop()` 检测 `state == STARTING` 时置 `stopRequested = true` 并返回，由服务在 `startForeground` 成功后自行 `stopSelf()`。新增 Test 23 第 8 组断言守卫 |
| I2 | `stopRequested` 在两处失败路径与 `onDestroy` 未复位，可能污染下一次启动 | 中 | 已修：`catch (second)` 与 `onDestroy` 均复位为 false |
| I3 | JS 退避到期后无人唤醒 `sync()`，退避形同虚设 | 中 | 已修：失败时 `setTimeout(sync, delay + 20)`，并在 cleanup 中 `clearTimeout` |
| I4 | `lastStopAt`/`failStreak`/`retryAfter` 放在 `useEffect` 闭包内，组件重挂载后冷却失效（路由切换即重挂载，这正是 stop→start 紧邻的高频来源） | 高 | 已修：三个变量提升到模块作用域，cleanup 里 stop 后也记录 `lastStopAt` |
| I5 | `update()` 对 `UNCONFIRMED` 也返回 false，JS 会走"服务已死"分支 stop 再重启，可能抖动 | 低 | 保留。理由：`UNCONFIRMED` 本义就是"投递了但没确认"，让 JS 重启是正确语义；且重启受 300ms 冷却与指数退避约束，不会高频抖动 |

### 1.3 自审已知局限（必须如实交代，不得写成已验证）

| # | 局限 | 影响 |
|---|------|------|
| L1 | **Kotlin 未编译验证** | 本机无 Android SDK（`ANDROID_HOME` 为空、无 gradle），Kotlin 改动只能靠 CI 编译。自审只做了逐行人工核对（见 §1.4），不构成编译通过的证据 |
| L2 | **未做真机验证** | 通知出现、后台保活、连点开关不闪退均未执行，交付时标注为"待用户验证" |
| L3 | **静态断言只能防结构回退** | Test 23 检查的是调用顺序与是否调用，不能证明运行时行为 |

### 1.4 Kotlin 逐行人工核对项

| 检查项 | 结论 |
|-------|------|
| `try` 作为语句且所有分支 `return` 时，`onStartCommand: Int` 是否需要末尾补 return | 不需要。Kotlin 控制流分析可见 try 块与两个 catch 分支均 `return START_NOT_STICKY`，函数体无落空路径 |
| `enum class ServiceState` 改成多行并加 KDoc 是否影响既有引用 | 不影响。枚举项名称未变，仅新增 `UNCONFIRMED`；引用点（`state = ServiceState.X`）全部用具名常量 |
| `companion object` 内 `private const val CHANNEL_ID` 被 `build()`/`fallbackNotification()`（同为 companion 成员）访问 | 合法，companion 内成员互相可见 |
| `foregroundType()` 引用 `ServiceInfo` 与 `Build` | 两个 import 均保留在文件头 |
| `handler` 在 `Module` 内创建，`OnDestroy` 中 `removeCallbacks` | 已处理；`Runnable` 为成员字段，不会被泄漏捕获 |
| `@Volatile` 是否足够保护 `state` / `stopRequested` | 足够。仅主线程写、主线程读，`@Volatile` 用于跨线程可见性兜底，无需锁 |
| `ServiceCompat.startForeground(this, id, notification, type)` 参数类型 | 与既有调用一致（原代码同签名），未改变 |

## 二、Sub-agent 独立审查

> 审查人：独立 sub-agent（未参与分析与实现）
> 实测执行：`vitest run` → 8 文件 60 项（审查当时）、`verify-fixes.mjs` → 22 套件、`tsc` 0 错、`check-i18n` ok
> 编译能力：`which java kotlinc gradle` 三者皆空，`ANDROID_HOME` 空 → 明确声明"Kotlin 未编译验证"

发现 14 条：high 2 / medium 5 / low 7。核心结论：

**H1（阻断，且推翻了我上一轮的结论）**：SAF 下 `new File(targetDir, name)` 被解析成 **tree 根文档**而非目标文件。`SAFDocumentFile.documentFile` 判 `pathSegments[0]`，对 `content://.../tree/primary%3ADownload/app.apk` 得 `"tree"` → `DocumentFile.fromTreeUri` → 取 `pathSegments[1]` = `primary:Download`，后续 `/app.apk` 段被丢弃。因此：
- `copy` 对目标先跑 `validateType()`：`exists()==true && isDirectory()==true` → 抛 `InvalidTypeFileException`，**首次下载即失败**
- `overwrite=true` 时 `deleteRecursively()` 会**删掉用户所选的整个目录**

**H2**：我把 `UNCONFIRMED` 当"服务已死"判据（`update()` 返回 false），JS 据此 `stop()`，而 `stop()` 只对 `STARTING` 延后 —— 在系统 4–5s 窗口内制造"提升前停服"，与铁律自相矛盾。

**H3**：`stopRequested` 的读改写跨线程（Expo 同步 `Function` 在 JS 线程、服务在 main），`@Volatile` 只保可见性不保原子性。我在自审 §1.4 写的"仅主线程读写"是**事实错误**。

其余：H4 冷却命中不调度重试会丢投递；H5 Test 23 未断言 preflight 失败必须 `return false`；H6 门槛数字 61 vs 实测 60；H7 目录选择器取消会弹错误提示（expo 抛 `PickerCancelledException` 而非返回 null）；L1 `onTimeout`/`onTaskRemoved` 未判 state；L3 `pickCreatedEntry` 的"新增唯一"启发式优先于同名匹配会误认领；L7 `lastStartError` 只写不读。

## 三、裁决

### 3.1 审查质量校验

| 检视项 | 结果 |
|-------|------|
| 每个发现是否有引用位置 | ✅ 14/14，全部带文件行号 + 依赖库源码行号 |
| 维度覆盖 | ✅ 7/7，且对本机无法编译做了显式声明而非含糊带过 |
| 严重度区分 | ✅ high 2 / medium 5 / low 7 |
| 是否独立分析 | ✅ 自行跑命令核对了测试实数，并用 node 复算了 `Paths.join` 结果 |

**审查有效性：通过。**

### 3.2 关键分歧仲裁：H1 是否成立

我用自己的独立取证复核了 H1，不采信单一来源：

| 取证点 | 证据 | 结论 |
|-------|------|------|
| `new File(dir, name)` 怎么拼 URI | `expo-file-system/src/File.ts:149-152`：`constructor(...uris) { super(Paths.join(...uris)) }`，`Paths.join` 是纯字符串拼接 | ✅ 确认是伪子 URI |
| SAF 下这个 URI 被判成什么 | `unifiedfile/SAFDocumentFile.kt:16-25`：`pathSegment = uri.pathSegments[0]`，非 `"document"` 一律 `DocumentFile.fromTreeUri` | ✅ 确认走 tree 分支 |
| `fromTreeUri` 取哪一段 | AOSP `DocumentsContract.getTreeDocumentId(uri)` 取 `pathSegments[1]` | ✅ 后续路径段被丢弃，指向目录本身 |
| copy 前会不会因此报错 | `FileSystemPath.copy` → `to.validateType()` → `file.exists() && file.isDirectory()` → `throw InvalidTypeFileException` | ✅ 首次下载就会抛，不止覆盖场景 |
| expo 自己怎么说 | `FileSystemFile.kt:52-54`：`File.create` 遇 content URI 直接抛 "does not work with SAF content:// uris, use `Directory.createFile` instead" | ✅ 官方明确要求走 Directory |

**裁决：H1 成立，且比 sub-agent 描述的更严重** —— 不是"覆盖有问题"，而是首次下载就失败。我上一轮说"下载已修复"是错的，判断依据是 `copy(finalDestFile, { overwrite })` 能通过编译、类型正确，却没有验证 SAF 下这个 File 到底指向什么。这是把"类型正确"当成"语义正确"。

### 3.3 处置表

| # | 处置 | 具体修改 |
|---|------|---------|
| **H1** | ✅ 已修 | `viewer.tsx` 改为 `await downloadedLocalFile.copy(targetDir, { overwrite: shouldOverwrite })`。传 Directory 走 `CopyMoveStrategy.SAF` 的 `isContainer=true` 分支，由 `DestinationSink` 调 `DocumentFile.createFile` 建真实文档。`record.targetUri` 仍由 `pickCreatedEntry` 从 `list()` 认领真实 document URI。新增 Test 21 反断言：`/new File\(\s*targetDir\s*,/` 不得出现 |
| **H2** | ✅ 已修 | `update()` 改为 `when(state)`：`IDLE → false`、`STARTING → true`（信交服务）、`UNCONFIRMED/RUNNING → 正常 notify`。`stop()` 的延后条件补上 `UNCONFIRMED` |
| **H3** | ✅ 已修 | `stopRequested` 从布尔改为**时间戳** `stopRequestedAt` + `requestStop()` / `clearStopRequest()` / `stopRequested` getter（TTL 10s 自动失效）。这不是"加锁"，而是消除了 check-then-act：写端无条件写时间戳，读端自己判新鲜度，不存在两线程共读一个布尔再决定写的窗口 |
| **H4** | ✅ 已修 | `lastStopAt` 仅在**确实调用了 stop** 时写入；冷却命中时 `setTimeout(sync, lastStopAt + STOP_COOLDOWN_MS - now + 20)` 补一次重试，不再丢投递 |
| **H5** | ✅ 已修 | Test 23 第 4 组追加正则：`/if\s*\(\s*!\s*KeepAliveService\.ensureChannelReady\([^)]*\)\s*\)\s*return@Function\s+false/` |
| **H6** | ✅ 已修 | `test-plan.md` 门槛改为实测数 ≥63 / ≥23；`test-cases.md` 与 `test-result.md` 同步（新增 TC-DL-19~22，删除失效的 TC-DL-15） |
| **H7** | ✅ 已修 | 新增纯函数 `isPickerCancelled(error)`（判 `code`/`message` 含 cancel），`viewer.tsx` 捕获取消时静默返回；删除 `if (!picked \|\| !picked.uri)` 死分支；新增 TC-DL-21/22 两个用例 |
| **L1** | ✅ 已修 | `onTimeout`/`onTaskRemoved` 收口到 `stopOrDefer()`：`RUNNING` 直接 stopSelf，否则 `requestStop()` |
| **L2** | ✅ 已修 | `update()` 在 `STARTING` 直接返回 true，不发 `notify`，避免非前台通知帧 |
| **L3** | ✅ 已修 | `pickCreatedEntry` 改为**名字匹配优先**，`added.length === 1` 降为兜底。新增 TC-DL-19（名字匹配优先于启发式）、TC-DL-20 |
| **L4** | ✅ 已修 | `want` 转 false 且确实停服时清零 `failStreak`/`retryAfter` |
| **L5** | ✅ 已修 | Test 23 的 `atStopSelf === -1` 空断言改为 `assert.notEqual(atStopSelf, -1)`；`startForeground` 断言加 `ServiceCompat.` 前缀 |
| **L6** | ⏳ 保持 | 修完 H1 后 `targetUri` 已是真实 document URI，`exists` 探测有效。仍需真机确认，列入待验证 |
| **L7** | ✅ 已修 | `lastStartError` 接入 `about.tsx` 诊断区（可点击复制）；`lastStartMissedAt` 保留但仅作为服务状态，不对外承诺 |

### 3.4 裁决结论

**代码审查驳回成立，全部 high 与 medium 项已闭环。** 本轮共修 12 处，其中 H1 属于**推翻前一轮结论级**的缺陷。

需要特别记录的一条教训已经写进 `summary.md`：**"类型检查通过"不等于"运行时语义正确"**。`copy(finalDestFile, { overwrite })` 在 TypeScript 和 Kotlin 签名上完全合法，但 SAF 下这个对象指向的是目录而不是文件。这类错误只有读底层 `fromTreeUri` 实现才能发现，编译器和类型系统永远不会报。

**准入：准予进入测试审查。** Kotlin 行为与真机行为仍未验证，交付时按 `test-result.md §五/§六` 如实标注。

