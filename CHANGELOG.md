# 更新日志 (Changelog)

## [v1.8.3-preview.27] - 2026-10-27

### ✨ 改进

- **图片默认满屏显示，保持原始比例**：原来图片被塞进一个固定 `aspectRatio: 1` 的方框里，宽图上下留大片空白、竖图两侧留白，等于永远只用了一半屏幕。现在图片页整页不滚动（`Screen scroll={!isImageFile}`），图片容器 `flex: 1` 撑满剩余空间，`contentFit="contain"` 保持比例，宽图占满宽度、竖图占满高度。
- **放大后可以拖动查看**：图片页既然不滚动，拖动就不会再和页面滚动抢手势，内嵌预览也放开 `pan`。
- **双指捏合不再抖动**：`pan` 增加 `.maxPointers(1)`。双指落下时 pan 原本也会激活并抢事件，导致缩放一顿一顿。

### 🧪 门禁

- Test 25 增加断言：图片页必须 `scroll={!isImageFile}`、容器必须 `flex: 1`、不得再出现 `aspectRatio: 1`、`pan` 必须限制单指。


## [v1.8.3-preview.26] - 2026-10-27

### 🛠 致命缺陷修复 (Critical)

- **捏合即 crash**：真机报 `com.facebook.jni.CppException: Property 'RUBBER_BAND_FLOOR' doesn't exist`。
  `clampScale` 的默认参数 `floor = RUBBER_BAND_FLOOR` 在 UI 线程求值时变量不存在——
  babel 的 worklet 插件只捕获**函数体**里直接引用的自由变量，**参数默认值里的不捕获**。
  现已移除所有 worklet 的默认参数，函数体改用字面量，模块常量只留给普通 JS 侧与测试使用。
- 同一问题在组件侧同样存在：`toOrigin`、`pan.onUpdate`、双击分支的 worklet 体里引用了 `MIN_SCALE`，
  一并改为字面量。

### 🧪 门禁

- 新增 Test 30：静态扫描 `imageZoom.ts` 的五个 worklet 与 `ZoomableImage.tsx` 的 worklet 回调，
  禁止出现任何模块常量名，并禁止 worklet 使用默认参数。
- 新增 TC-ZOOM-12：用运行时行为反查「worklet 里的字面量」与「导出常量」是否仍然同值，
  防止以后改常量忘了改字面量。
- 变异验证：把崩溃原样写回去（默认参数引用 `RUBBER_BAND_FLOOR`）→ 拦住；函数体引用 `MIN_SCALE` → 拦住；
  组件 worklet 引用 `MIN_SCALE` → 拦住。


## [v1.8.3-preview.25] - 2026-10-27

> 审查的 medium 级发现与关键 low 级发现，全部修复并补上对应门禁。

### ⚠️ 构建配置修复（影响所有历史 preview 包）

- **`versionCode` 一直停在 13**：`android/` 整个目录被 `.gitignore` 排除，是 `prebuild` 的产物。历次发布的版本号只改在 `android/app/build.gradle` 里，**从未进入仓库**，CI 每次 prebuild 都用 `app.json` 的 `expo.android.versionCode` 重新生成，所以 preview.17 到 preview.24 的安装包版本号全是 13。现已把 `versionCode` 提到 39，并在 `app.json` 修正为唯一真源。
- **`REQUEST_INSTALL_PACKAGES` 同样写在会被覆盖的文件里**：已改到 `app.json` 的 `expo.android.permissions`。
- 新增 Test 29 锁定：`versionCode > 0` 且不低于 39，`app.json` 的 `expo.version` 必须与 CHANGELOG 首条一致。

### 🛠 修复 (Fixes)

- **缩小后图片停在屏幕外**：捏合结束时只回写倍率，没按新倍率重新夹取已有偏移。5x 拖到边角再缩回 1.5x，可移动范围变小而旧偏移还在，图片直接跑到可视区外。现在捏合结束会重夹 `tx/ty`。
- **单击误切倍率**：`Tap().onEnd` 忽略第二个参数 `success`，而 RNGH 在 handler 由 ACTIVE 转 FAILED/CANCELLED 时同样会回调。一次最终被判定为单击的点击会顺手执行双击分支。两个 Tap 现在都先判 `success`。
- **内嵌预览抢页面滚动**：图片挂在页面的 ScrollView 里，Pan 手势和纵向滚动互相抢，用户想滚页面结果在拖图。内嵌预览改为 `enablePan={false}`（缩放与单击进全屏仍可用），全屏内才允许拖动。
- **点击「打开所在目录」无反应**：四层降级全失败时 native 返回 false，原来没有提示。现在会 toast 实际保存目录。
- **电池优化状态不刷新**：状态在 render 期只读一次，用户去系统设置改完返回仍显示旧的「受限」。改为 `useFocusEffect` 每次回到页面重读。
- **APK 打不开安装器**：`inferMimeType` 让服务端声明的 MIME 压过扩展名，而服务端把 `.apk` 标成 `text/plain` 很常见。改为 `.apk` 分支优先。
- **全屏关闭按钮压刘海**：硬编码 `top: 48` 改为 `insets.top + 12`。
- **打开文件失败无反馈**：fallback 选择器也可能抛错，原来无保护地再调一次并返回 true。改为统一 `attemptStart`，失败如实返回 false。
- **SAF 目录交给第三方只给读权限**：tree URI 需要 `FLAG_GRANT_PREFIX_URI_PERMISSION` 才能让文件管理器继续遍历子目录。

### 🧹 清理

- 删除零引用的死代码 `ZoomableImageFrame`。
- 删除 `viewer.tsx` 中已不再使用的 `expo-image` 导入。
- 浮点容差 `0.001` 抽成命名常量 `SCALE_EPSILON`。
- 修正 `clampScale` 注释与实现的矛盾（注释声称会兜底回弹，实际只做夹取）。

### 🧪 门禁

- 新增 Test 28：Tap 必须判 success、内嵌必须关 pan、捏合结束必须重夹、容差必须是命名常量、全屏按钮必须避让安全区、`.apk` 分支必须早于 serverMime。
- **变异验证累计 16/16 全部拦住**。


## [v1.8.3-preview.24] - 2026-10-27

> preview.23 的图片手势与国产 ROM 适配存在三条真机必崩的死路径，本版全部修复，并由三路独立审查确认。

### 🛠 致命缺陷修复 (Critical)

- **手势一捏就崩**：`imageZoom.ts` 的五个纯函数被 `Gesture.onUpdate/onEnd` 的 worklet 回调直接调用，却没有 `'worklet'` 指令。babel 自动 workletize 后，这些函数在 UI 线程被还原成 remote-function guard，首次捏合即抛 `Tried to synchronously call a Remote Function`，**捏合/拖动/单击/双击全部失效**。已给五个函数补齐指令。
- **全屏其实没全屏**：原实现用 `<Screen>` 内的 `absoluteFill`，而 `Screen` 默认 `scroll=true`，黑层只覆盖滚动内容区、会被滚走、也盖不住 Stack header，返回键还会直接退出整个 viewer。改用 `Modal` + `statusBarTranslucent` + `onRequestClose`，并给 Modal 内的手势套上独立的 `GestureHandlerRootView`。
- **国产 ROM 适配在真机上全静默失效**：模块 manifest 缺 `<queries>`，targetSdk≥30 的包可见性过滤让 `resolveActivity` 对所有未声明包恒返回 null——五家厂商文件管理器探测全部 `continue`，自启动永远退到应用详情页。已补 `com.android.documentsui` / 小米 / 华为 / OPPO / vivo / 三星 等包名与两个 VIEW intent。
- **APK 装不上**：缺 `REQUEST_INSTALL_PACKAGES`，targetSdk>25 下无法把 APK 交给系统安装器。已补。
- **图片能被拖出屏幕**：平移边界把容器尺寸当成内容尺寸传入，400pt 容器内 16:9 图在 5x 时允许位移 800pt（真实溢出仅 362pt），取满后整幅图移出视野只剩纯黑。改为用 `onLoad` 拿到图片原始尺寸、按 contain 比例算出真实占位后再夹边界。
- **降级链被提前终止**：`DocumentsUI` 分支用 `EXTRA_INITIAL_URI`，但该 extra 仅对 `OPEN_DOCUMENT*` 生效，`FilesActivity` 只认 `getData()`。结果是打开 Files 首页却报"成功"，把后面的厂商降级整段屏蔽。改为 `data = docUri`。
- **自启动跳转失败无感知**：`openAutoStartSettings` 降级后仍返回 `true`。改为返回 `'autostart' | 'appdetails' | ''`，UI 据此提示"未识别到本机自启动管理页"。

### 🧪 测试门禁加固

- 删除 Test 1 / Test 2 的**循环自证**（在测试内重写实现再断言副本，改坏生产代码仍全绿）。路径规范化逻辑下沉到 `src/lib/pathNormalize.ts`，新增 10 项真实 import 的单测；Test 1 改为读 `ModelPicker.tsx` 真实源码断言。
- Test 25 从"函数名出现过"改为断言**真实调用点**——此前 `import` 那一行就能满足断言。
- 新增 Test 26（五个手势函数必须带 `'worklet'`）、Test 27（`<queries>` 与安装权限必须声明）。
- Test 24 增加 Activity 类名断言（此前只查包名）、禁止常量短路 `if (true ||`、要求 `continue` 必须是真语句而非注释。
- **变异验证 13/13 全部拦住**（此前 11 个变异改坏后仍全绿）：删 worklet、全屏退回 absoluteFill、删 queries、平移改回容器尺寸、单击绕过纯函数、探测短路、注释掉 continue、类名写错、层 2 改回 EXTRA_INITIAL_URI、删 MIME_TYPE_DIR、纵向传错尺寸、去掉 Exclusive、filter 改成不过滤。


## [v1.8.3-preview.23] - 2026-10-27

### ✨ 新增 (Features)

- **图片查看器支持手势缩放**：原来图片只是一个静态 `<Image>`，`contentFit="contain"`，手指捏合完全无反应。现接入自研 `ZoomableImage`（复用项目已有的 gesture-handler 2.32 + reanimated 4.5.1，未引入新依赖）：
  - **双指捏合** 1x–5x 缩放，捏合过程中允许短暂缩到 0.7x，松手低于 1x 自动回弹；超过 5x 夹住，避免只剩马赛克；
  - **放大后单指拖动**，按「(内容尺寸 × 倍率 − 容器尺寸) / 2」夹取边界，不会把图片拖出屏幕只剩黑底；
  - **双击** 在 1x 与 2.5x 之间往返；
  - **单击切换全屏**：原始大小单击进入全屏（黑底、遮住页面其余内容），再单击退出；放大状态下单击是**复位**而不是退出全屏，避免想回全貌却直接退出。
  - 手势回调只读写 shared value，全部判断逻辑下沉到 `src/lib/imageZoom.ts` 纯函数，由 11 项单测覆盖。


## [v1.8.3-preview.22] - 2026-10-26

### ✨ 新增 (Features)

- **国产 ROM 后台保活引导**：「关于」页新增「后台保活」分组：
  - **电池优化**：可读取真实豁免状态（`isIgnoringBatteryOptimizations`），未豁免时一键发起系统豁免请求；
  - **自启动**：按厂商精确跳转自启动管理页（小米/Redmi/POCO `com.miui.securitycenter`、华为/荣耀 `com.huawei.systemmanager`、OPPO/realme/一加 `com.coloros.safecenter`、vivo/iQOO `com.vivo.permissionmanager`、三星 `com.samsung.android.sm`），组件不可用时自动降级到应用详情页。
  - 说明：Android 至今**没有公开 API 可读取或写入自启动开关**，因此只能跳转引导，无法代用户开启。

### 🛠 缺陷修复 (Fixes)

- **「打开所在目录」补齐四层降级**：国产 ROM 普遍用自家文件管理器替换系统 DocumentsUI，仅发 `ACTION_VIEW + MIME_TYPE_DIR` 会静默无响应（点击没反应）。现按序降级：
  1. 隐式 `ACTION_VIEW` + `MIME_TYPE_DIR`（排除浏览器/Google 抢注）；
  2. 显式 `com.android.documentsui.files.FilesActivity` + `EXTRA_INITIAL_URI`；
  3. 厂商文件管理器（小米/华为/ColorOS/vivo 组件，先 `resolveActivity` 探测再启动）；
  4. `ACTION_OPEN_DOCUMENT_TREE` + `EXTRA_INITIAL_URI` 兜底，保证一定能到达目录。

## [v1.8.3-preview.21] - 2026-10-26

### 🛠 缺陷修复 (Fixes)

- **原生重构【打开文件】：彻底根除 `ExpoSharing.shareAsync` 导致的 `content://` 崩溃**：
  - 根因：`openFile` 原本调用了 `expo-sharing`，而其 Android 源码硬编码 `if ("file" != uri.scheme) throw InvalidArgumentException("Only local file URLs are supported...")`，传入 SAF 落盘的 `content://` 协议时直接报错闪退；
  - 修复：接入原生 `HermesKeepAlive.openFile`，直接发起原生 `ACTION_VIEW` Intent，赋予 `FLAG_GRANT_READ_URI_PERMISSION` 并根据文件后缀精确识别 MIME 类型（APK 识别为 `application/vnd.android.package-archive`，点击直接唤起系统安装器，普通文档唤起系统查看器），彻底解耦分享与打开。
- **原生定向【打开所在目录】：彻底根除呼出 Google 等无关 App 的弹窗**：
  - 根因：原本调用通用的 `Linking.openURL(dirUri)`，系统向全局应用广播未指定类型的 content 协议，被注册了通用过滤器的 Google 应用拦截并弹出“想要打开Google”授权提示；
  - 修复：接入原生 `HermesKeepAlive.openFolder`，构造针对 Document 的显式 Intent 并绑定 `DocumentsContract.Document.MIME_TYPE_DIR`，定向呼出系统文件管理器（DocumentsUI / Files），杜绝第三方应用抢占。

## [v1.8.3-preview.20] - 2026-10-26

### 🛠 缺陷修复 (Fixes)

- **回前台强制探活，修复保活静默失效**：服务在后台被系统回收（六小时限额、任务划走）后，JS 侧因"标题没变"而一直以为它还在跑，保活实际已死却不报错。现在每次回到前台都会重新校验服务是否存活，失败立即重建。
- **目录选择器"取消"不再弹错误**：expo 以 `PickerCancelledException` 抛取消，此前被当成真实错误 toast 出来。

### ✅ 工程

- **前台服务行为测试接入构建**：`scripts/build-apk.sh` 在 `assembleRelease` 之前执行 `:hermes-keepalive:testReleaseUnitTest`。前台提升顺序是运行时属性，"先提升后停"和"先停后提升"在源码里是同一组调用，只有真跑服务才分得清；一旦被改回去，构建直接失败。
- **删除 Test 17（死代码自证）**：它断言的是客户端已废弃的 bulk-delete payload，与生产代码零绑定。
- **Test 20 改为读真实源码**：从"断言脚本内自建的对象"改为读取 `sessions.tsx` / `SessionMenu.tsx` / 协议表，能真正拦住"改回离线 bulk-delete"。
- 单测 71 项、回归套件 22 项。

## [v1.8.3-preview.19] - 2026-10-26

### 🛠 缺陷修复 (Fixes)

- **修复前台服务 5 秒超时闪退（`ForegroundServiceDidNotStartInTimeException`）**：
  - 根因：系统对每次 `startForegroundService()` 记账，必须在数秒内 `startForeground()`；此前 `ensureChannel`/`build` 在 try 之外、catch 里直接 `stopSelf()`、看门狗到点 `stopService()`、模块 `OnDestroy` 停服，四条路径都会让这条要求永远无法满足；
  - `onStartCommand` 首条语句即 `startForeground()`，失败改用最小系统通知重试，不再提前 `stopSelf`；
  - 投递前增加 preflight：通知渠道不可用则不投递（不投递 = 系统不记账 = 不可能超时）；
  - 看门狗改为只上报不改生命周期；服务启动窗口内的停止请求改为带 TTL 的延迟停止，由服务在提升前台后自己执行；
  - JS 侧补 300ms 停服冷却与指数退避（1s→30s 封顶），并修掉"服务已死但仍被当作在跑"的裂脑分支。
- **修复 SAF 下载落盘失败与覆盖误删目录**：
  - 根因：`new File(dir, name)` 是纯字符串拼路径，SAF 下会被 `DocumentFile.fromTreeUri` 解析成**目录本身**（后续路径段被丢弃），首次下载即抛 `InvalidTypeFileException`，选"覆盖"更会递归删除整个所选文件夹；
  - 改为 `copy(targetDir, { overwrite })`，由底层 `DocumentFile.createFile` 建出真实文档；
  - 落盘后回目录按名字认领**真实 document URI** 写入记录，修复"下载成功但重进仍显示下载按钮"。
- **修复目录选择器"取消"被当成错误弹窗**：expo 以 `PickerCancelledException` 抛取消，现改为静默返回。
- **修复已下载状态被反向退回"下载"**：存在性探测失败时降级为"文件可能已被移动"，不再清空记录。
- **关于页新增后台服务诊断项**：前台服务启动失败的原因可直接查看并复制。

### ✅ 工程

- 新增 `src/lib/keepAlivePolicy.ts` 纯逻辑模块（冷却 + 退避），由 11 项单测真实 `import` 覆盖；
- 新增 `src/lib/downloadManager.ts` 的 `pickCreatedEntry` / `isPickerCancelled` 与对应用例；
- `verify-fixes.mjs` 新增 Test 23（前台服务提升顺序与 preflight 接线，含去注释后比下标的结构断言）；
- 单测 63 项、回归套件 23 项全绿。

## [v1.8.3-preview.17] - 2026-10-26

### 🚀 新增功能 (Features)
- **侧边栏底栏重构：全新【信息与版本】按键及弹窗**：
  - 彻底移除侧边栏原本冗长的底栏文字条，将底部导航栏收敛紧凑；
  - 在【会话】、【智能体】、【自动化】、【设置】旁新增第 5 个紧凑按键：
    - **常规态**：展示圆圈感叹号 `Info` 图标，文案【信息】；
    - **发现新版本**：图标动态点亮并变更为向上的升级箭头 `ArrowUpCircle`，文案变更为【更新】，同时点亮红点提示；
  - **版本与更新详情弹窗 (VersionModal)**：
    - 点击进入弹窗，清晰呈现当前客户端版本（如 `v1.8.3`）与网关版本（如 `v8.0.41`）；
    - 内置标准国际化【检查更新】按键，支持即时手动查询最新版本；
    - 发现新版本时直观展示版本号与更新提示，并提供直达【下载更新】按键。
- **真·先选目录后下载与大文件原地预览**：
  - 下载前置选目录：未授权目录前绝不发起后台下载网络请求，零流量浪费；
  - 支持大代码/MD/HTML/文本文件直接【下载并预览】流式原地阅读；
  - 二进制大文件支持真正调用 SAF 选定外部文件夹安全落盘并给出清晰路径提示；
  - 覆盖文件时先执行物理删除规避 Android 原生追加 `(1)` 副本的硬编码问题；
  - 彻底规避重进页面落盘状态假死问题与临时缓存双倍占用问题。
- **彻底根除下载 OOM：零内存 Base64 触碰**：
  - 修复：彻底剔除 `base64()` 与任何 JS 内存暂存逻辑，完全交由原生流式管道接管，零内存膨胀，彻底根除 OOM。
- **消息操作栏与指标极限单行紧凑化 (防换行防截断)**：
  - 彻底精简右侧元数据文本：由冗长的 `16:08 已工作 22分46秒 · 7.9 tok/s` 极简化为 `16:08 · 22分46秒 · 7.9t/s`，直接节省超过 45% 的横向空间；
  - 左右两端在一行内从容留白、完全展示，绝不再发生换行或被右侧边界生硬截断！

### 🛠 体验优化与缺陷修复 (Fixes & Improvements)
- **全面建立全自动化测试防御门禁 (52 项测试全绿)**：
  - 统一 CI 门禁，将 31 项单元测试与 21 项回归套件整合进 `npm test`，实现秒级本地自测与 CI 强制阻断防腐。
- **重构会话删除：彻底消除 `Exclusive maintenance refused` 报错**：
  - 全面切至实时长连接在线网关协议 `rpc().request('session.delete', { session_id, profile })`，由网关自身执行删除，彻底杜绝锁冲突。
- **修复在线推理耗时与 TPS 未记录问题**：
  - 在前台发送与网关响应双重阶段锁定 `turnStartedAt`，回答完成秒级计算耗时与 TPS。
- **相册/照片库权限拦截与调用修复**：
  - 补齐 Android 原生动态相册授权检查 `requestMediaLibraryPermissionsAsync()`，彻底修复相册唤起崩溃问题。
- **安装包双重签名修复 (v1 + v2 全兼容)**：
  - 在 `signingConfigs.release` 强制开启 `v1SigningEnabled` 与 `v2SigningEnabled`，彻底解决国产定制系统安装器“未签名/无法安装”的拦截。
