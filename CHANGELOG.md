# 更新日志 (Changelog)

## [v1.9.0] - 2026-10-27

自 v1.8.1 起 61 个提交、32 个文件、+2724 / −121 行。

---

## 新增

### 图片查看器

图片此前由静态 `expo-image` 渲染（`contentFit="contain"`），渲染链上无任何手势层，缩放不可用。

- **捏合缩放**：1x–5x。捏合过程允许下探至 0.7x，松手低于 1x 回弹；超过 5x 夹取。手势回调运行于 UI 线程（Reanimated worklet），判定逻辑下沉至 `src/lib/imageZoom.ts` 纯函数。
- **放大后平移**：边界按 `(内容尺寸 × 倍率 − 容器尺寸) / 2` 夹取。内容尺寸取 `onLoad` 回调的真实解码尺寸，而非容器尺寸——后者会让 5x 下的 16:9 图片允许位移 800pt（真实溢出仅 362pt），取满即整幅移出视口。
- **双击**：1x ↔ 2.5x。
- **单击全屏**：由 `Modal` 承载（`statusBarTranslucent` + `onRequestClose`）。`<Screen>` 默认 `scroll=true`，子节点上的 `absoluteFill` 仅覆盖滚动内容区，会被滚走且盖不住 Stack header。放大态单击为复位，非退出全屏。
- **满屏适配**：图片页 `scroll={false}`，容器 `flex: 1` 吃满剩余空间，`contentFit="contain"` 保持比例。移除了此前的 `aspectRatio: 1` 容器——它把任意比例图片压进正方形，宽图上下留白过半。
- **手势竞争**：`pan` 限定 `.maxPointers(1)`。双指落下时 `pan` 亦会激活并抢占事件，导致缩放抖动。

### 打开文件与打开目录

- **`openFile`**：原生 `ACTION_VIEW` + `setDataAndType(uri, mime)` + `FLAG_GRANT_READ_URI_PERMISSION`。MIME 由扩展名推断，`.apk` 映射为 `application/vnd.android.package-archive` 以唤起系统安装器。
- **`openFolder`** 四层降级：隐式 `ACTION_VIEW` + `MIME_TYPE_DIR` → 显式 `com.android.documentsui.files.FilesActivity`（落点由 `getData()` 决定）→ 厂商文件管理器（`resolveActivity` 探测后启动）→ `ACTION_OPEN_DOCUMENT_TREE` 兜底。
- **包可见性**：模块 manifest 声明 `<queries>`（含 11 个厂商包名与两条 VIEW intent）。targetSdk ≥ 30 下，未声明的包 `PackageManager.resolveActivity()` 恒返回 null，会使第三层降级与自启动跳转在真机静默失效。
- **安装权限**：补 `REQUEST_INSTALL_PACKAGES`。

### 下载

- 落盘走 SAF（`StorageAccessFramework`），下载前先选定目标目录；取消选择即中止，不产生流量。
- 实时进度、速率、已传输/总字节。
- 同名冲突提供自动重命名与覆盖两种策略。
- 已落盘记录在重进页面时显示「打开文件 / 打开所在目录」，不再回落为下载入口。

### 后台保活

「关于」页新增分组：

- **电池优化**：`PowerManager.isIgnoringBatteryOptimizations()` 读取真实状态，未豁免时发起 `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`；页面重新聚焦时刷新。
- **自启动**：按 `Build.MANUFACTURER` 映射至厂商管理页（小米/Redmi/POCO `com.miui.securitycenter`、华为/荣耀 `com.huawei.systemmanager`、OPPO/realme/一加 `com.coloros.safecenter`、vivo/iQOO `com.vivo.permissionmanager`、三星 `com.samsung.android.sm`），`resolveActivity` 失败时降级至应用详情页并显式提示。
- Android 无公开 API 可读写自启动开关，此项仅能跳转引导。

### 界面与交互

- 侧边栏底部导航由 4 键改为 5 键紧凑布局，移除常驻版本条，新增「信息」入口。
- 版本弹窗：当前版本、更新可用性、手动检查更新；检测到新版本时入口图标切换为 `ArrowUpCircle`。
- 输入区重排：模型选择左对齐、批准模式右固定，操作按钮收敛至 24×24。
- 消息操作栏：文本选择、复制；助手回复附带本轮耗时与 tokens/s。
- 操作栏与统计合并单行，长内容 `flexShrink` 收缩而非折行。
- 批准模式三态（自动批准 / 需确认 / 全部拒绝），以颜色区分。
- 表格支持横向滚动；长文档支持跨段落连续选择；文件链接与文本支持长按复制。
- 推理强度标签本地化。
- 子代理状态移出输入区。

---

## 修复

### 下载

- **大文件 OOM 崩溃** — `java.lang.OutOfMemoryError: Failed to allocate a 227178112 byte allocation`。根因：JS 层对 82MB 文件调用 `base64()`，解码产生约 3 倍堆膨胀。改流式管道：`File.downloadFileAsync` 落地私有缓存 → 原生 `FileChannel` 直写 SAF → 立即删除缓存，JS 堆全程不持有文件内容。
- **下载实际走分享面板** — 旧实现降级调用 `Sharing.shareAsync`，文件未落盘。改为 SAF 物理写入。
- **选择「覆盖」仍报同名已存在** — 旧实现以 `new File(treeUri, name)` 构造目标，该 URI 被 `DocumentFile.fromTreeUri` 解析为目录本身（`getTreeDocumentId` 仅取 `pathSegments[1]`，后续段丢弃），`delete()` 为空操作，`copy()` 抛 `InvalidTypeFileException`。改为向 `Directory` 复制，由底层 `DocumentFile.createFile` 建立真实文档。
- **已下载文件仍显示下载按钮** — 记录中存的是拼接出的伪 URI，`exists()` 恒假，记录被当作脏数据清除。改为落盘后回 `list()` 认领真实 document URI（名字匹配优先，唯一新增条目兜底）。

### 打开文件与打开目录

- **`Only local file URLs are supported (expected scheme to be 'file', got 'content://...')`** — `expo-sharing` 的 `SharingModule.kt:94` 硬编码校验 `file` scheme。SAF 产物为 `content://`，必然抛错。改原生 `ACTION_VIEW`。
- **打开目录唤起「Hermes 想要打开 Google」** — 旧实现为无类型 `Linking.openURL(content://...)`，系统按 scheme 全局匹配，被注册通用 filter 的应用截获。改为指定 `MIME_TYPE_DIR` 定向文件管理器。

### 前台服务

- **`ForegroundServiceDidNotStartInTimeException`** — Android 对每次 `startForegroundService()` 挂载待决要求，`stopSelf()`/`stopService()` 不会撤销该要求，使「未提升即停止」与「从未提升」同构，同样抛异常。修复：`onStartCommand` 首条语句即 `startForeground()`；提交通知前做 channel preflight，不通过则不投递服务（不投递即不记账）；看门狗仅上报状态，不介入生命周期；提升窗口内的停止请求以带 TTL 的时间戳延后执行。
- **回前台后保活状态失真** — 原实现仅在启动时探测一次。改为 `AppState` 切换至前台时重置缓存并重新探活。

### 显示

- 模型列表未过滤未认证 provider。
- 中文词条缺失、部分界面中英混排；补充缺失键并将校验纳入 CI。
- 会话列表反向滚动时偶发跳顶。

### 构建与安装

- **`versionCode` 长期固定为 13** — `android/` 整目录在 `.gitignore` 中，属 prebuild 产物；此前修改 `android/app/build.gradle` 未进入仓库，CI 每次 prebuild 均以 `app.json` 的 `expo.android.versionCode` 重新生成。统一以 `app.json` 为单一真源。
- **部分设备安装失败** — 启用 v1（JAR）+ v2 双签名。

### 测试

- 新增 `src/lib/metrics.ts`、`downloadManager.ts`、`keepAlivePolicy.ts`、`imageZoom.ts`、`pathNormalize.ts` 等纯逻辑模块，测试真实 `import` 生产代码。
- 单测 96 项，静态门禁 29 组；关键路径经变异验证（实现改坏后门禁必须变红）。

---

## 已知限制

- 手势响应、`Modal` 全屏在具体 ROM 上的覆盖范围、各厂商自启动页组件名有效性，均需真机验证。
- 厂商 ComponentName 随 ROM 版本漂移，已以 `resolveActivity` 探测与多级降级兜底，彻底变更时可能回落至应用详情页。

## [v1.8.3-preview.31] - 2026-10-27

### ↩ 撤销

- **撤销「客户端能力自述提示词」**（preview.28–30）。结论是当前 agent 本来就清楚 MEDIA 交付方式，客户端注入属于重复建设，还平白占首轮 token。
  - 移除 `src/lib/mediaPrompt.ts`、`src/lib/workspacePath.ts` 及其单测。
  - `textOf()` 恢复为纯文本拼接，不再做剥离。
  - chat store 恢复为只发 `text`，不再拼能力说明、不再预取工作区路径。
  - `PromptSubmitParams` 里错误的 `api_text` 字段保持移除（它本来就不在 wire 契约里，传了会被直接拒绝）。

### 保留下来的

- preview.27 的图片能力：默认满屏保持比例、双指缩放、放大后可拖动、双击切换倍率、单击进全屏。
- preview.26 的 worklet 修复（不再引用模块作用域）。


## [v1.8.3-preview.30] - 2026-10-27

### 🛠 致命修复

- **新会话发消息直接报错**：preview.29 传了 `api_text`，服务端契约 `PromptSubmitParams` 用 pydantic `extra=forbid`，字段表里没有它，直接拒绝：
  `invalid params for prompt.submit: api_text: Extra inputs are not permitted`。
  之前只看到 `session_cli_turn.py` 的 `_SUBMIT_FIELDS` 里有这个键，那是**进程内部**的 admission 字段，不经过 wire 校验——取证没闭环。
- **改为拼接 + 渲染剥离**：首轮把能力说明接在用户文本后面，用 `\n\n<!--hermes-client-capability:v1-->\n` 分隔；
  `textOf()` 是所有文本渲染的唯一入口，在那里对用户消息调用 `stripCapability()` 剥掉。
  发送时的本地气泡和从服务端重新加载的历史都不会露出这段，模型仍能读到。
- `PromptSubmitParams` 里错误的 `api_text` 字段已撤掉，与真实契约对齐。

### 🧪 门禁

- Test 31 重写：契约与客户端代码（剥掉注释后）都不得出现 `api_text`；必须有 `CAPABILITY_MARKER` 与 `stripCapability`；`textOf()` 必须对 user 消息剥离、且不得动 assistant 文本；首轮判断、真实 cwd 传递、提示词内容、无硬编码路径。
- TC-MEDIA-12~15：拼接后可剥离回原文、无标记不误伤、剥离幂等、非首轮不带标记。
- 变异验证：重新传 `api_text`、`textOf` 不剥离、首轮恒真 —— 三个都被拦住。


## [v1.8.3-preview.29] - 2026-10-27

### 🛠 修复

- **能力提示词里的路径不再写死**：preview.28 的示例直接写了 `MEDIA:/opt/data/workspace/reports/2026-10-27.md`，这个前缀只在本机成立，换任何部署都会指向不存在的目录。
  - 新增 `src/lib/workspacePath.ts`：向服务端 `GET /api/chat/workspaces` 取 `default_cwd`，取一次缓存。
  - 示例路径由真实 `default_cwd` 拼出；**取不到就完全不给示例**，只保留「不确定当前工作目录时，先执行 pwd 或 ls 确认，不要假设前缀」这条规则。
  - 提示词正文里不再出现任何绝对路径前缀。

### 🧪 门禁

- TC-MEDIA-08~11：提示词不得含 `/opt/data`、`/home/`、`C:\`、`~/.`；必须写明「不要假设前缀」；传入真实 cwd 时示例用它；拿不到时不得出现任何路径；尾部斜杠不拼出双斜杠。
- Test 31 追加：`workspacePath.ts` 代码部分（剥掉注释）不得出现绝对路径；chat store 必须真的 await 服务端返回值再拼提示词。
- 变异验证：提示词写死路径、workspace 兜底常量、绕过服务端直接用常量 —— 三个都被拦住。


## [v1.8.3-preview.28] - 2026-10-27

### ✨ 新增：客户端能力自述（media 交付提示词）

新会话的第一条消息会自动带上一段**只有模型能看到**的能力说明，教会模型如何在这个客户端里把文件交给你。

- 走 `prompt.submit` 的 `api_text` 字段（gateway 侧 `session_cli_turn.py` 早已支持，客户端契约一直漏了它）：`text` 是存库并显示给用户的内容，`api_text` 才是模型实际读到的内容。所以这段说明不会出现在你的聊天气泡里。
- 内容：`MEDIA:/服务端绝对路径` 的用法、必须绝对路径、一行一个、禁 base64 内联、图片/PDF/Markdown/压缩包/APK 通用。
- 只注入首轮，后续轮次不重复烧 token；但因为它留在会话历史里，后续轮次模型依然看得见。
- 之前的问题：模型不知道当前是哪个客户端、不知道文件该怎么发，只能靠猜或让用户自己找路径。

### 🧪 门禁

- Test 31：契约必须声明 `api_text`、首轮判断必须是「非编辑且历史里还没有用户消息」、`api_text` 只在该轮发送、用户可见的仍是原文。
- TC-MEDIA-01~07：注入时机与提示词内容（必须含 MEDIA 语法、绝对路径、禁 base64、覆盖三类交付物）。
- 变异验证：首轮判断改成恒真、把 `api_text` 改回 `text`、从契约删掉 `api_text` —— 三个都被拦住。


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
