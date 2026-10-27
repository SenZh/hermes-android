# Learnings — hermes-android 踩坑记录

> 按 handbook `knowledge-base.md` 要求，修 bug / 设计失误后必须在此留痕，防止复发。
> 每条格式：现象 → 根因 → 规则。

## 1. SAF 下 `new File(dir, name)` 指向的是目录，不是文件

**现象**：下载落盘报 `InvalidTypeFileException`，或"覆盖"时把用户选的整个文件夹删了。

**根因**：`new File(dir, name)` 在 JS 层就是 `Paths.join(...)` 纯字符串拼接，得到
`content://.../tree/primary%3ADownload/app.apk`。而 `SAFDocumentFile` 判 `uri.pathSegments[0]`，
非 `"document"` 就一律 `DocumentFile.fromTreeUri`；AOSP 的 `getTreeDocumentId` 只取
`pathSegments[1]`（`primary:Download`），后面 `/app.apk` 被直接丢弃 → 解析成目录本身。
`copy()` 前会跑 `validateType()`，看到 `exists && isDirectory` 就抛 `InvalidTypeFileException`。

**规则**：
- SAF 目录下要操作某个子文件，只能从 `Directory.list()` 的结果里拿**真实 entry**（`content://.../document/<docId>`），或先 `Directory.createFile()` 再操作它返回的对象。
- 往 SAF 目录写文件，`copy()` 的目标传 **Directory**（走 `isContainer=true` 分支，由底层 `DocumentFile.createFile` 建真实文档），不要传 `new File(dir, name)`。
- 写完要拿真实 URI：`list()` 前后对比，按名字认领。别把拼出来的伪 URI 写进持久化记录，否则下次 `exists()` 恒假，状态全丢。

## 2. 用 `startForegroundService()` 记账后，`startForeground()` 之前不能有任何 stop

**现象**：`android.app.RemoteServiceException$ForegroundServiceDidNotStartInTimeException`，主线程崩溃。

**根因**：系统对每次 `startForegroundService()` 都挂一条"必须在数秒内提升前台"的要求。
`stopSelf()` / `stopService()` 不会撤销这条要求，只会在要求仍未满足时让它彻底无法满足。
所以 catch 里 `stopSelf()`、看门狗到点 `stopService()`、模块 `OnDestroy` 里停服，三者都同构于崩溃本身。

**规则**：
- `startForeground()` 成功之前禁止任何 stop 动作。
- 防线前移到投递前的 preflight（channel 必须可用才投递）——不投递就不记账，就没有超时。
- 服务内首条语句必须是 `startForeground()`，失败用最小通知重试，不要 `stopSelf`。
- 需要停服但服务还在启动窗口内时，记一个带 TTL 的时间戳，由服务在提升成功后自己停。

## 3. "类型检查通过"不等于"运行时语义正确"

**现象**：`copy(finalDestFile, { overwrite: true })` 在 TS 与 Kotlin 签名上都合法、能编译，实际运行时目标指向目录。

**根因**：类型只约束形状，不约束这个对象在底层被解释成什么。涉及 SAF / content URI / 跨层封装时，必须读对方的原生实现确认语义。

**规则**：改动依赖库行为相关的代码，至少读一遍依赖的原生实现（本文第 1、2 条都是这么发现的）。别用"编译器没报错"当验证依据。

## 4. expo 的选择器取消是抛异常，不是返回 null

**现象**：用户在系统目录选择器点"取消"，App 弹出错误提示。

**根因**：`Directory.pickDirectoryAsync` 取消时抛 `PickerCancelledException`（message: "The file picker was cancelled by the user"），不返回 null。

**规则**：所有 picker 调用都要用 `isPickerCancelled(e)` 之类的方式识别取消并静默返回；`if (!picked || !picked.uri) return` 是死代码，别写。

## 5. 测试门禁里 `includes` 断言挡不住"调用顺序被破坏"

**现象**：`verify-fixes.mjs` 里写 `src.includes('startForeground')`，结果一行注释就能满足；改了调用顺序照样全绿。

**规则**：
- 顺序类约束必须切出方法体后比 `indexOf`。
- 断言前先 `stripComments`（块注释 → 行注释 → KDoc 续行三层）。
- 反向约束（"不得出现某调用"）比正向包含更有鉴别力，优先写反向。
- 断言里的关键调用要带前缀（`ServiceCompat.startForeground` 而不是 `startForeground`）。

## 2026-10-27 图片手势查看器

- **worklet 内不能引用模块级标识符**，包括参数默认值。真机 `Property 'RUBBER_BAND_FLOOR' doesn't exist` 首次触摸即 crash。babel 只捕获函数体里引用的自由变量。改字面量 + 运行时反查一致性。
- **`android/` 整目录在 .gitignore**，`build.gradle` 的 versionCode / `AndroidManifest.xml` 的权限都是 prebuild 产物。改那里等于没改，必须改 `app.json`。此前 versionCode 长期停在 13。
- **门禁不能读 prebuild 产物**：CI 的 check job 跑在 prebuild 之前，读 `android/app/...` 必 ENOENT。要模拟 CI 就是先把 `android/` 移走再跑测试。
- **静态断言要断言调用点，不是名字出现过**：`component.includes('clampTranslation')` 会被顶部 import 满足。变异测试 16 个里曾有 11 个改坏仍全绿。
- **`<Screen>` 默认 scroll=true**，子节点上的 `absoluteFill` 只能覆盖滚动内容区，做全屏必须用 `Modal`。
- **图片满屏**：容器写 `aspectRatio: 1` 会把任何图塞进正方形，宽图上下留白。要 `flex: 1` + `contentFit="contain"`，并让页面本身不滚动。
- **双指捏合时 `pan` 会一起激活**，抢事件导致缩放抖动。`pan` 要加 `.maxPointers(1)`。
- **发布纪律**：内测包只在本地流转，不得创建 GitHub Release 或推 tag；GitHub 上只允许纯三位正式版。
