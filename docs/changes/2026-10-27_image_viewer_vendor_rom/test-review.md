# 测试审查报告

审查对象：`2026-10-27_image_viewer_vendor_rom`（v1.8.3-preview.23 + preview.22 的测试与门禁）
审查时间：2026-10-27
审查基线：`4aa83bd`，`npm test` 全绿（vitest 9 文件 / 84 用例 + verify-fixes 24 套件）

## 结论

**Conditional Pass** —— L1 纯函数单测是真实有效的（21 个变异中 10 个被准确拦红），但 L2 静态断言存在结构性漏洞：**11 个变异改坏实现后仍全绿**，其中 9 个是能让功能完全失效的回归（捏合/拖动根本没接上、runOnJS 删除、单击语义短路、厂商探测短路、组件类名写错、下载路径规范化损坏），因此当前门禁**不足以支撑"已修复、可提交"的结论**，须先补 UI 层行为测试与断言收紧。

---

## 审查方法

对 21 处关键实现逐个做真实变异（改源码 → 跑 `npm test` → 记录红/绿 → `git checkout` 还原），全部结果为实测，不是推断。脚本见 `/opt/data/cache/scratch/mutate.py`，变异清单见 `muts.json`/`muts2.json`/`muts3.json`。审查结束时工作区已还原（`git status` 仅剩未跟踪的 docs 目录）。

---

## 变异测试分析

| # | 变异点 | 位置 | 测试是否会红 | 依据（实测） | 缺失用例 |
|---|--------|------|-------------|--------------|----------|
| M1 | `resolveSingleTap` 去掉 `+0.001` epsilon 且 `>` 改 `>=` | `src/lib/imageZoom.ts:41` | ✅ 红 | TC-ZOOM-05（`resolveSingleTap(1)` 变 `'reset'`）与 TC-ZOOM-07 同时失败 | — |
| M1b | 仅把 `>` 改成 `>=`（保留 epsilon） | 同上 | ❌ **绿** | 无任何用例命中 `scale` 精确等于 `1.001` 的边界；断言只取 1 / 1.0000001 / 1.5 / 5 四点 | 补 `resolveSingleTap(0.9999/1/1.001/1.002)` 四点边界用例 |
| M2 | 把 `Gesture.Simultaneous(Exclusive, Simultaneous(pinch,pan))` 整体换成 `Gesture.Exclusive(doubleTap, singleTap)`（**pinch/pan 从此没接到 GestureDetector 上，捏合与拖动彻底失效**） | `src/components/ZoomableImage.tsx:87-90` | ❌ **绿** | Test 25 只查 `component.includes('Gesture.Pinch()')`（:822）、`'Gesture.Pan()'`（:823），而这两个字面量在 `:42`/`:54` 的**定义处**就存在，接线被删也与断言无关 | 断言 `Gesture.Simultaneous(`/组合表达式结构，或改为渲染后断言手势对象树；根治靠 L1.5 组件测试 |
| M2b | `Gesture.Exclusive(doubleTap, singleTap)` 改 `Gesture.Simultaneous(...)` | `ZoomableImage.tsx:88` | ✅ 红 | Test 25:830 精确匹配字面量，断言消息明确 | — |
| M3 | 删掉 `runOnJS(onSingleTap)()`，直接 `onSingleTap()` | `ZoomableImage.tsx:83` | ❌ **绿** | Test 25:834 只查 `component.includes('runOnJS')`，而 `:4` 的 import 语句已包含该字符串；删调用不动 import | 断言 `runOnJS(onSingleTap)()` 调用形态（或 `:4` import 与 `:83` 调用两处都要有）；根治靠组件测试 |
| M3b | `if (resolveSingleTap(scale.value) === 'reset')` 改成 `if (false && resolveSingleTap(...))`（放大后单击变成直接退出全屏） | `ZoomableImage.tsx:80` | ❌ **绿** | 静态断言只查 `component.includes('resolveSingleTap')`；纯函数本身没被改，L1 自然全绿。R3 的后半句语义无任何自动化守护 | 组件测试断言"放大态单击 → 停在 1x 且不调用 onSingleTap" |
| M4 | 删掉 `clampTranslation` 的 `if (overflow <= 0) return 0` | `imageZoom.ts:61` | ✅ 红 | TC-ZOOM-11 得到 `-100`，失败信息 `expected -100 to be +0` | — |
| M5 | 删掉 `clampScale` 的 `Number.isNaN` 判断 | `imageZoom.ts:23` | ✅ 红 | TC-ZOOM-03 拿到 `NaN` | — |
| M6 | 删掉 `openFolder` L3 的 `resolveActivity` 探测整段 | `HermesKeepAliveModule.kt:197-199` | ✅ 红 | Test 24:801 断言 `folderBody.includes('resolveActivity')`（本行实际为 :768） | — |
| M6b | 保留 `resolveActivity` 字样但写成 `if (true \|\| context.packageManager.resolveActivity(...) == null)`（探测成死代码，L3 永远 continue，国产 ROM 直接掉到 L4 弹授权树） | `HermesKeepAliveModule.kt:197` | ❌ **绿** | 这正是历史已知的"加个条件包住关键调用"绕过法；字符串仍在，断言满足 | 断言应校验语义而非存在性：用 Kotlin 单测（Robolectric，项目已有——见 `92f5231`）跑 `pickFolderIntent` 的顺序决策 |
| M7 | 删掉 `inferMimeType` 的 apk 分支 | `src/lib/downloadManager.ts:93` | ✅ 红 | TC-DL-23 得到 `*/*` | — |
| M8 | viewer 内联预览改回裸 `<Image>` | `src/app/viewer.tsx:586` | ✅ 红 | Test 25:809 的 300 字符窗口正则未命中 `ZoomableImage` | — |
| M9 | `tx.value = clampTranslation(...)` 改成 `tx.value = originTx.value + e.translationX`（原始平移，可把图拖出屏幕） | `ZoomableImage.tsx:57` | ❌ **绿** | Test 25:841 `component.includes('clampTranslation')` 由 `:6` 的 import 满足 | 断言每个纯函数在**回调体内**被调用（剥离 import 行后再匹配），或组件测试 |
| M10 | `if (shouldSnapBack(scale.value))` 改成 `if (false)`（松手不回弹，卡在 0.7x 模糊态，直接违反 R1 验收标准） | `ZoomableImage.tsx:47` | ❌ **绿** | 同上，`shouldSnapBack` 由 import 行满足 | 同上 |
| N1 | 删掉 viewer 路径规范化里"`/opt/data/` 绝对路径原样保留"分支（`/opt/data/xxx` 被拼成 `/opt/data/workspace/opt/data/xxx`，文件打不开） | `viewer.tsx:53-60` | ❌ **绿** | Test 2 在 `verify-fixes.mjs:42` **自己重写了一份** `normalizeAndVerify`，断言的是副本，生产代码改坏与它无关 | 把规范化逻辑下沉到 `src/lib/pathSandbox.ts` 并 L1 真实 import；删除 Test 2 的副本 |
| N2 | `openFile` 退回 `await Sharing.shareAsync(...)`（content:// 崩溃，R4 复发） | `viewer.tsx:170` | ✅ 红 | Test 22:578-582 明确断言 `openFileBody.includes('Sharing.shareAsync') === false` | — |
| N4 | L2 的 DocumentsUI Activity 类名改成不存在的 `...BogusActivity` | `HermesKeepAliveModule.kt:182` | ❌ **绿** | Test 24:756 只查包名 `com.android.documentsui`，不查类名 | 断言完整 `ComponentName(pkg, cls)` 二元组 |
| N5 | 小米自启动组件类名改成不存在的 `...BogusActivity` | `HermesKeepAliveModule.kt:254` | ❌ **绿** | Test 24:774-776 只 `autoFn.includes(pkg)`，五个厂商全部只查包名 | 同上，逐条断言 `(pkg, activity)` 对 |
| N6 | `inferMimeType` 不再把 `application/octet-stream` 当未知处理 | `downloadManager.ts:89` | ✅ 红 | TC-DL-23 第二句失败 | — |
| O4 | `MAX_SCALE` 5 → 1.2（低于需求"至少 3x"） | `imageZoom.ts:11` | ✅ 红 | 被 TC-ZOOM-01 的 `clampScale(2.4) === 2.4` 这条无关字面量意外拦住 | — |
| O5 | `DOUBLE_TAP_SCALE` 2.5 → 1.05（双击等于没变化） | `imageZoom.ts:13` | ❌ **绿** | TC-ZOOM-08 的期望值就是导入的 `DOUBLE_TAP_SCALE` 常量（`tests/imageZoom.test.ts:56-58`），常量改了什么都能自洽 | 期望值写死字面量 `expect(nextDoubleTapScale(1)).toBe(2.5)` |

**统计：21 个变异，10 红 / 11 绿。其中 9 个绿是会导致功能失效的真实回归（M2、M3、M3b、M6b、M9、M10、N1、N4、N5），2 个是边界/常量级（M1b、O5）。**

---

## 发现清单

| # | 严重度 | 位置 | 问题 | 修复建议 |
|---|--------|------|------|----------|
| 1 | 严重 | `scripts/verify-fixes.mjs:39-82`（Test 2） | **循环自证**：测试内自建 `normalizeAndVerify`（:42-71），断言的是这份副本，从不读取 `viewer.tsx` 的规范化代码。实测 N1 把生产代码改坏，Test 2 依然 PASS 并打印"Path normalizer strictly maps relative and workspace files to managed root"。这正是 AGENTS.md 明令禁止的形态 | 把 `:53-71` 的规范化抽成 `src/lib/pathSandbox.ts`（`normalizePath(raw)` + `isInsideRoot(p)`），写 `tests/pathSandbox.test.ts` 真实 import；删掉 Test 2 的副本，改为静态断言"viewer 调用了 `normalizePath`"（形状校验交给 L1） |
| 2 | 严重 | `scripts/verify-fixes.mjs:6-37`（Test 1） | **循环自证**：`rawProviders` 数组（:8-14）与两条过滤表达式（:18、:27）都写在测试里，生产代码 `ModelPicker`/`ModelChooser` 一行都没读。而且 :18 与 :27 两种写法（`!!p.authenticated` vs `p.authenticated !== false`）对同一份数据给出相同结果，等于用两份同构的假实现互相"验证" | 过滤规则抽为 `src/lib/providerFilter.ts` 纯函数并 L1 覆盖；或删掉该用例——它现在提供的唯一信息是"Node 的 Array.filter 正常工作" |
| 3 | 严重 | `scripts/verify-fixes.mjs:839-842`（Test 25） | `component.includes(fn)` 会被 `ZoomableImage.tsx:6` 的 import 语句满足。实测 M9（pan 直接原始平移）、M10（`if (false)` 取消回弹）双绿。这两处恰好是最核心的 R1/R2 实现 | 先剥掉 import 行再匹配调用：`component.split('\n').filter(l => !l.startsWith('import')).join('\n').includes(\`\${fn}(\`)`；更根本的是引入组件测试（见发现 #5） |
| 4 | 严重 | `scripts/verify-fixes.mjs:833-836`（Test 25） | `runOnJS` 存在性断言由 `:4` 的 import 满足。实测 M3 删掉 `runOnJS(onSingleTap)()` 改直呼，仍绿；真机上 UI 线程调用 JS 回调会直接抛错或静默失效 | 断言 `runOnJS(onSingleTap)` 这一调用形态；并保留一条"UI 线程外调用必须包裹"的 lint 级检查 |
| 5 | 严重 | 全仓（`tests/` 目录） | **无任何组件/接线层测试**。`@testing-library/react-native@^14.1.0` 已装（`package.json`），但 9 个测试文件全是纯函数。结果是"手势有没有接上"这一整类回归（M2/M3/M3b/M9/M10，占变异失败的 5/11）全靠 `includes` 兜底，全部兜不住 | 补 `tests/ZoomableImage.test.tsx`：mock `react-native-gesture-handler` 的 handler 表，拿到 `onUpdate/onEnd` 后手工喂事件对象，断言 shared value 与 `onSingleTap` 调用次数。这样 M1b/M2/M3/M3b/M9/M10 六条都能转红 |
| 6 | 严重 | `HermesKeepAliveModule.kt:197` | 静态断言对 `resolveActivity` 只做存在性检查，写成 `if (true \|\| ...)` 即绕过（M6b 实测绿）。这是用户明确点名的历史绕过手法，且本轮**未修** | 见 #7 的 Kotlin 单测方案；静态断言至少应校验 `resolveActivity` 出现在 `continue` 之前且未被 `\|\|` 短路（用 AST 或至少正则排除 `true \|\|`/`&& false`） |
| 7 | 严重 | `HermesKeepAliveModule.kt:189-206` | 四层降级的**顺序**与**短路语义**零覆盖。Test 24 只证明"四个字符串都在文件里"，不证明 L1 失败才走 L2、L3 探测不到就跳过。厂商列表 `:190-194` 里 `com.android.fileexplorer`、`com.coloros.filemanager`、`com.vivo.filemanager` 三个包名连字符串断言都没有 | 把降级决策提纯：`fun folderCandidates(docUri, installed: Set<ComponentName>): List<Intent>`，用 Robolectric（仓库已有该基础设施，见 `92f5231`）断言候选序列；静态侧把五个厂商组件写成 `(pkg, cls)` 逐条断言 |
| 8 | 高 | `HermesKeepAliveModule.kt:182`、`:254`、`:258`、`:264`、`:269`、`:274` | 只断言包名不断言 Activity 类名。实测 N4/N5 把类名改成 `BogusActivity` 全绿——而这正是"厂商页面组件名随 ROM 版本失效"这一真实故障模式的主因（`tech-design` 自己也承认"名字会变"） | 断言成对出现：`assert.ok(src.includes('ComponentName("com.android.documentsui", "com.android.documentsui.files.FilesActivity")'))` 式的完整二元组 |
| 9 | 高 | `src/lib/imageZoom.ts`（全文 65 行） | 五个纯函数**没有一个带 `'worklet'` 指令**（全文 grep 无 worklet），却被 `ZoomableImage.tsx:44/47/57/68/80` 在 RNGH 手势回调（UI 线程 worklet）内直接调用。按 Reanimated 规则，worklet 内调用非同文件的非 worklet 函数会抛 `Tried to synchronously call a non-worklet function on the UI thread`。**这是代码层推理，未经真机验证**，但 Test 25:839-842 恰恰把"必须调用这五个纯函数"写成了门禁，等于把潜在崩溃点固化为合规项 | 给五个函数加 `'worklet'` 指令（保持 L1 可测不受影响），并在 L3 清单第 1 条后追加"捏合时观察 Metro 日志有无 non-worklet 报错" |
| 10 | 高 | `src/components/ZoomableImage.tsx:57-58` | 垂直方向把 `boxW` 同时当容器与内容尺寸：`clampTranslation(originTy + e.translationY, boxW.value, boxW.value, scale)`。`contentFit="contain"` 下竖屏查看横向图时，内容实际高度 < `boxH`，此处的 `overflow` 算出来的可拖范围偏大，纵向可把图拖出边界留黑底——直接违反 R2 验收标准。L1 无法发现，因为 `clampTranslation` 本身是对的，错在调用点传参 | 改为 `clampTranslation(originTy + e.translationY, boxH.value, contentH.value, scale)`，`contentH` 需要按图片固有宽高比与 `boxW/boxH` 算出（可下沉为 `imageZoom.ts` 的 `fitContentSize(boxW, boxH, naturalW, naturalH)` 纯函数并 L1 覆盖） |
| 11 | 中 | `tests/imageZoom.test.ts:18,23,28,29,41,45-46,56-58` | 期望值大量取自被测常量（`MAX_SCALE`/`MIN_SCALE`/`RUBBER_BAND_FLOOR`/`DOUBLE_TAP_SCALE`）。实测 O5 把 `DOUBLE_TAP_SCALE` 改成 1.05（双击等于没变化）全绿。断言语义退化为"函数返回了自己引用的那个常量" | 需求侧数字写死字面量：`expect(nextDoubleTapScale(1)).toBe(2.5)`、`expect(clampScale(99)).toBe(5)`；常量只用于生产代码 |
| 12 | 中 | `scripts/verify-fixes.mjs:801-844`（Test 25 全段） | 除 M8 外，全部断言是 `includes` 字符串存在性，断言消息却写成行为描述（"pinch-to-zoom must be wired"）。失败时无法区分"没接线"与"改了写法"，与历史事故同源 | 消息改为"断言对象 + 期望形态"，或统一走 #5 的组件测试；静态层只保留 `viewer 用 ZoomableImage 而非裸 Image` 这一条形状约束 |
| 13 | 中 | `src/app/viewer.tsx:161-177`（`openFile`） | R5（APK 进系统安装器）的原生半边无任何测试：Test 22 只证明 JS 侧调了 `KeepAlive.openFile`，`HermesKeepAliveModule.kt:122-143` 的 `ACTION_VIEW + setDataAndType + FLAG_GRANT_READ_URI_PERMISSION` 组合零覆盖。若 `addFlags(FLAG_GRANT_READ_URI_PERMISSION)` 被删，安装器会因读不到 content:// 直接失败，门禁全绿 | Robolectric 断言构造出的 Intent：`action == ACTION_VIEW`、`type == package-archive`、`flags and FLAG_GRANT_READ_URI_PERMISSION != 0` |
| 14 | 低 | `scripts/verify-fixes.mjs:608`→`:737` | 编号从 `[Test 16]`（:393）跳到 `[Test 18]`（:418），没有 `[Test 17]`；末尾 :873 的 `ALL 24 SUITES PASSED` 是硬编码字符串，与实际执行函数数量不联动（注释掉一个用例，横幅照样说 24） | 编号连续化；横幅改为 `ALL ${count} SUITES PASSED`，并在 `runAll` 里统计实际执行数 |
| 15 | 低 | `scripts/verify-fixes.mjs:576-577`、`:589-590` | `slice(indexOf(...), indexOf(...))` 的区间提取依赖函数定义顺序，若在 `openFile` 之前插入新函数（例如 `openFolder` 上移）区间会变成空串，`includes(...)===false` 的断言（:578）会**假通过** | 提取前先断言 `openFileBody.length > 0`，或改用正则从函数头匹配到下一个 `async function` |

---

## 需求覆盖矩阵

| 需求 ID | 覆盖它的测试 | 层级 | 是否充分 |
|---------|-------------|------|----------|
| R1 双指捏合 1x–5x、松手不回弹 | TC-ZOOM-01/02/03/04（`tests/imageZoom.test.ts:16-36`，真实 import）；Test 25:822 | L1 + L2 | **不充分**：纯函数覆盖率好，但"有没有接上 pinch"与"松手是否真的回弹"只靠 `includes`，M2/M10 全绿；`'worklet'` 缺陷可能让整条链路在真机直接抛错（发现 #9） |
| R2 放大后拖动、不拖出屏幕 | TC-ZOOM-09/10/11（:63-76） | L1 + L2 | **不充分**：`clampTranslation` 本身测得扎实（M4 红），但调用点纵轴传参错误（发现 #10）与 M9（绕过 clampTranslation）均无法被任何测试发现 |
| R3 单击撑满 / 再单击返回 / 放大态单击复位 | TC-ZOOM-05/06/07（:40-51）；Test 25:813-817、:830 | L1 + L2 | **不充分**：`resolveSingleTap` 语义正确且有边界用例缺失（M1b 绿），但"组件是否遵守返回值"无守（M3b 绿），`runOnJS` 断言被 import 满足（M3 绿） |
| R4 打开文件不报 scheme 错误 | Test 22:575-586（断言 `openFileBody` 不含 `Sharing.shareAsync` 且含 `KeepAlive.openFile(...)`）；TC-DL-23/24 | L2 + L1 | **基本充分**：N2 实测红，是本轮最扎实的一条静态断言（区间提取脆弱性见发现 #15）。缺口：`KeepAlive.available === false` 时退化到 `Linking.openURL` 的分支无人守 |
| R5 APK 被系统安装器接管 | TC-DL-23（mime 推断）；Test 22:583-586（JS 侧调用） | L1 + L2 | **半充分**：MIME 正确性有守（M7/N6 红），原生 `Intent` 构造（action/type/flags）零覆盖（发现 #13），而 flags 缺失正是安装器失败的典型原因 |
| R6 打开所在目录不弹 Google | Test 24:748-770（四层字符串）；Test 22:588-594 | L2 | **不充分**：M6b（`if (true \|\| ...)` 短路）、N4（类名写错）全绿；降级**顺序**与**短路语义**零覆盖（发现 #6/#7）；厂商列表 5 个组件里 3 个连字符串断言都没有 |
| R7 国产 ROM 保活引导入口 | Test 24:774-796（五家包名 + manifest 权限 + about.tsx 入口）；`about.tsx:78-97` 实为真实 `onPress` 调用 | L2 | **基本充分但同病**：N5（小米类名写错）绿；好在 about.tsx 的两处入口经人工确认是真实 `onPress` 而非注释/字符串。`batteryOptimizationIgnored()` 在渲染期直接调用亦有性能隐患（非测试范畴） |
| R8 保持既有下载逻辑不变 | `tests/download.test.ts` 全 20 用例（TC-DL-01~24，真实 import）；Test 22 | L1 + L2 | **充分**：`downloadManager.ts` 7 个导出函数全部真实 import 且断言具体，M7/N6 均红。唯一缺口是 viewer 侧路径规范化（N1 绿），严格说属于 R4 的上游而非 R8 |

**未覆盖需求条目：无整条遗漏。但 R1/R2/R3/R6 属于"有用例、拦不住"类型的伪覆盖，比缺失更危险。**

---

## 分层合理性

分工设计的本意是对的（L1 决策逻辑 / L2 形状约束 / L3 手感），实际执行有两处错位：

1. **该单测的东西被推给静态断言**：`viewer.tsx:53-71` 的路径规范化、`ZoomableImage` 的手势回调分支，都是纯逻辑，本可下沉到 `src/lib/` 后 L1 覆盖，现在分别退化成"测试内副本"（发现 #1）和"字符串存在性"（发现 #3）。这不是 L2 的职责，L2 只能证形状。
2. **L2 的断言强度低于其声明的职责**：Test 24 的注释写着"vendor components must be probed before being launched"，实际只查 `includes('resolveActivity')`，一条 `if (true || ...)` 就能废掉探测（发现 #6）。L2 越是声称自己覆盖行为，越容易让人误以为有行为保护。
3. **L3 被当成兜底**：手势接线的 5 个变异全部只能靠 L3 人工发现，而 L3 清单（`test-plan.md` 第 3 节）没有"看 Metro 日志有无 non-worklet 报错""横屏图纵向拖动边界"这两项，恰好对应发现 #9 与 #10。

## 可维护性

- 用例 ID 体系（`TC-ZOOM-xx`/`TC-DL-xx`/`Test NN`）设计良好，`test-plan.md` 的用例表与代码一一对应，可追溯性是目前最好的部分。
- 断言消息质量两极：`tests/imageZoom.test.ts` 与 `tests/download.test.ts` 的消息是中文行为描述 + 具体数值，失败即可定位（如 `expected -100 to be +0` 直接指向 overflow 分支）；而 `verify-fixes.mjs` 的 14 条相关消息全是"must be wired / must delegate to"，M2 那种失败时只会告诉你"pinch-to-zoom must be wired"，而实际上 `Gesture.Pinch()` 就在那儿——**消息说 A，断言查 B**。
- 编号断档（缺 Test 17）与硬编码总数（:873）会随用例增删持续腐化，属于低成本即可修的一类（发现 #14）。

## 如认为无问题的维度，给出理由

- **真实性（L1 层面）：无问题。** `tests/imageZoom.test.ts:3-13` 与 `tests/download.test.ts:4-12` 均为 `import ... from '@/lib/...'` 的真实导入，vitest alias 指向 `src`（`vitest.config.mts`），断言对象是生产模块的导出函数，测试内没有任何 mock 替身。两个文件的 11 + 20 条断言全部直接调用生产函数，无自证。问题仅存在于 `verify-fixes.mjs` 的 Test 1 / Test 2，已单列为发现 #1、#2。
- **有效性（L1 层面）：无问题。** 10 个红变异中有 7 个由 L1 独立拦下（M1/M4/M5/M7/N6/O4 与部分 M1b 相邻项），说明纯函数层的断言确实卡在真实分支上（`overflow <= 0`、`Number.isNaN`、apk 分支这些都一改就红），不是"跑了就有分"的形式主义。
- **分层清晰度（概念层）：无问题。** `test-plan.md` 的三层定义与各自"局限"一栏写得准确，甚至预先声明了"文本断言可被绕过（历史已发生过）"——认识是对的，只是本轮的执行没有跟上这个认识，属于落地缺口而非设计缺陷。
