# 主 agent 裁决记录

日期：2026-10-27
输入：`code-review.md`（Reject，23 条）、`test-review.md`（Conditional Pass，11/21 变异漏过）、`design-review.md`（Conditional Pass，19 条论断中 7 条不成立）

## 一、三份结论的交叉验证

| 审查 | 结论 | 与其他两份是否一致 |
|------|------|-------------------|
| 代码审查 | Reject | 与测试审查在「门禁拦不住手势层回归」上一致；与方案审查在「厂商探测因包可见性失效」上一致 |
| 测试审查 | Conditional Pass | 与代码审查在 worklet 与平移边界上独立复现；变异清单与代码审查的 high #1/#14 重合 |
| 方案审查 | Conditional Pass | 独立指出 `EXTRA_INITIAL_URI` 对 FilesActivity 无效，与代码审查 medium #7 一致 |

三份报告在四条关键缺陷上互相独立地得出同一结论，判定为**真实缺陷，不是审查噪声**。

## 二、high 级发现（3 条，全部接受并修复）

| # | 来源 | 处置 | 修复方式 |
|---|------|------|---------|
| 1 | 代码审查 + 测试审查 + 方案审查 | 接受 | 五个纯函数补 `'worklet'`；新增 Test 26 锁定 |
| 2 | 代码审查 | 接受 | 全屏改 `Modal` + `onRequestClose` + 独立 `GestureHandlerRootView` |
| 3 | 代码审查 + 方案审查 | 接受 | 模块 manifest 补 `<queries>`（11 个包 + 2 个 intent）；新增 Test 27 锁定 |

## 三、medium 级发现（8 条）

| # | 问题 | 处置 | 说明 |
|---|------|------|------|
| 4 | 捏合结束未按新倍率重夹偏移 | 修复 | pinch.onEnd 重夹 `tx/ty`，Test 28 锁定 |
| 5 | Tap 忽略 `success` 参数 | 修复 | 两个 Tap 都判 `success`，Test 28 锁定 |
| 6 | openFile fallback 无保护 | 修复 | 统一 `attemptStart`，失败返回 false |
| 7 | L2 用 `EXTRA_INITIAL_URI` 无效 | 修复 | 改 `data = docUri`，Test 24 锁定且禁止该分支出现 EXTRA_INITIAL_URI |
| 8 | 缺 `FLAG_GRANT_PREFIX_URI_PERMISSION` | 修复 | 加入 openFolder flags |
| 9 | 内嵌图片与页面滚动抢手势 | 修复（方案调整） | 内嵌 `enablePan={false}`，全屏才允许拖动。理由：内嵌区域小，拖动价值低于滚动，且手势竞争无法在 ScrollView 内可靠解决 |
| 10 | 电池状态无 focus 刷新 | 修复 | `useFocusEffect` 重读 |
| 11 | 门禁与测试不覆盖 worklet 与平移 | 修复 | Test 26/28 + 变异验证 |

## 四、low 级发现（12 条）

| # | 问题 | 处置 |
|---|------|------|
| 12 | clampScale 注释与实现不符 | 修复（改注释） |
| 13 | `1 + 0.001` 魔数重复 | 修复（抽 `SCALE_EPSILON`） |
| 14 | 平移用容器尺寸当内容尺寸 | 修复（onLoad 取真实尺寸） |
| 15 | `ZoomableImageFrame` 死代码 | 删除 |
| 16 | `expo-image` 未使用导入 | 删除 |
| 17 | serverMime 压过扩展名 | 修复（`.apk` 优先）+ TC-DL-25 |
| 18 | `fileSize` 读闭包旧 state | **不改**。记录的是下载瞬间的快照，用最终值反而与「已保存」卡片语义冲突。接受 |
| 19 | watchdog 置 UNCONFIRMED 后不复位 | **不改**。看门狗按设计只上报状态、不碰生命周期，复位由下一次 `update()` 或 Service 销毁负责。改动会引入新的竞态 |
| 20 | 内嵌与全屏各渲染一份 ZoomableImage | **不改**。expo-image 对同一 URI 有内存缓存，且全屏是 Modal 独立窗口，共享不现实。标记为已知 |
| 21 | openFolder native 返回 false 无提示 | 修复（toast 保存目录） |
| 22 | toast 用 finalTargetName 而非 SAF realName | **不改本轮**。属于下载链路的既有行为，用户要求「保持当前逻辑」，改动需单独评估 |
| 23 | 全屏按钮硬编码 top:48 | 修复（`insets.top + 12`） |

## 五、审查未覆盖、由执行过程暴露的两个问题

| 问题 | 严重度 | 处置 |
|------|--------|------|
| `versionCode` 长期停在 13：`android/` 被 gitignore，改 build.gradle 无效 | **high** | 已修：`app.json` 提到 39，Test 29 锁定 |
| verify-fixes 读 `android/app/src/main/AndroidManifest.xml`，CI 的 check job 跑在 prebuild 之前必 ENOENT | **high** | 已修：改读 `app.json`；并用「移走 android/ 目录」模拟 CI 验证 |

第二条是主 agent 的流程违规：只在本机跑通过就推送，未模拟 CI 环境。

## 六、变异验证结果

修复前：测试审查实测 21 个变异中 **11 个改坏后仍全绿**。
修复后：主 agent 实测 **16/16 全部被拦住**。

| 变异 | 结果 |
|------|------|
| 删 clampScale 的 worklet | 拦住（Test 26） |
| 全屏改回 absoluteFill | 拦住（Test 25） |
| 删 queries 声明 | 拦住（Test 27） |
| 平移改回容器尺寸 | 拦住（Test 25） |
| 单击绕过纯函数 | 拦住（Test 25 调用点断言） |
| 厂商探测 `if (true \|\|` 短路 | 拦住（Test 24 常量短路禁令） |
| continue 被注释掉 | 拦住（Test 24 整行匹配） |
| 自启动 Activity 类名写错 | 拦住（Test 24 类名断言） |
| L2 改回 EXTRA_INITIAL_URI | 拦住（Test 24） |
| 删 MIME_TYPE_DIR | 拦住（Test 24） |
| 纵向传错尺寸 | 拦住（Test 25） |
| 去掉 Gesture.Exclusive | 拦住（Test 25） |
| ModelPicker filter 改成不过滤 | 拦住（Test 1 改读真实源码） |
| Tap 不判 success | 拦住（Test 28） |
| 内嵌开启 pan | 拦住（Test 28） |
| 缩小时不重夹偏移 | 拦住（Test 28） |

## 七、裁决

- 代码审查 **Reject** → 接受。high 3 条、medium 8 条全部修复；low 12 条中 8 条修复、4 条给出不改的理由。
- 测试审查 **Conditional Pass** → 接受。循环自证的两条测试已重写，路径逻辑下沉为真实单测，变异逃逸从 11 降到 0。
- 方案审查 **Conditional Pass** → 部分接受。3.5 平移近似的严重性被低估（已按真实后果修复）；3.7 的 `EXTRA_INITIAL_URI` 论断已修正；3.8 的 `resolveActivity` 依赖包可见性已补 `<queries>`。方案文档中相应段落已在该文件内标注修正。

**最终判定：可提交，待真机验证。** 剩余风险全部集中在无法自动化验证的部分：手势手感、Modal 全屏在具体 ROM 上的覆盖、五个厂商自启动页的组件名是否仍然有效。
