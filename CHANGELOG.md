# 更新日志 (Changelog)

## [v1.9.0] - 2026-10-27

距离上一个正式版 v1.8.1 有 61 个提交、32 个文件、+2724 / −121 行。下面按「新功能」和「修复」分开写。

---

## 新功能

### 应用内看文件，不用先下载

聊天里发来的文件链接，点开直接进全页查看器。

- Markdown 正常渲染：标题、列表、表格、代码块都对
- 纯文本可以长按选择、复制，跨段落也能连续选
- 表格太宽可以横向滑动，不会把字挤成一列
- 代码块带语法高亮，右上角有复制按钮
- 助手输出的 `MEDIA:` 指令会自动变成可点的文件卡片

### 看图

以前图片就是一张贴图，捏合完全没反应。现在：

- 两指捏合放大缩小，最大 5 倍，松手不会卡在半大不小
- 放大后单指拖动看细节，拖到边就停，不会把图拖出屏幕剩一片黑
- 双击在原始大小和 2.5 倍之间切换
- 单击进全屏（纯黑底，顶栏隐藏），再单击退出；放大状态下单击是复位
- **一打开就铺满屏幕、保持原始比例**——以前图片被塞进正方形框，宽图上下留大片空白

### 下载

- 下载前先让你选存到哪个文件夹，取消就不下载、不耗流量
- 有实时进度、速度、已下载/总大小
- 目标位置有同名文件时，可以选自动改名或者覆盖
- 下过一次的文件，再进来直接显示「打开文件 / 打开所在目录」，不会再冒出一个「下载」按钮

### 国产手机后台保活

「关于」页新增「后台保活」：

- 能读到现在电池优化到底是「已豁免」还是「受限」，没豁免可以一键去申请
- 自启动按你的手机品牌精确跳转：小米/Redmi/POCO、华为/荣耀、OPPO/realme/一加、vivo/iQOO、三星
- 如果这个系统没有已知的自启动页，会跳到应用设置并明确告诉你

> 说明：安卓本身没有公开接口能读或改自启动开关，所有 App 都只能跳转引导，谁说自己能"自动开启"都是假的。

### 界面

- 侧边栏底部 4 个按钮改成 5 个紧凑按钮，新增「信息」入口
- 点「信息」弹出窗口：当前版本号、有没有新版、手动「检查更新」；发现新版时那个图标会变成向上的箭头
- 每条回复下面有操作栏：选择文本、复制
- 显示本轮耗时和生成速度（tokens/s）

---

## 修复

### 下载相关的崩溃和错误

- **点下载直接崩溃**：82MB 的文件以前会把整个文件读进 JS 内存做 base64，瞬间申请 227MB 连续内存，安卓直接 OOM。现在全程流式写盘，JS 内存完全不碰文件内容。
- **点下载弹出分享面板**：以前"下载"其实是调系统分享，文件根本没存到手机。现在是真的写进你选的那个文件夹。
- **选了"覆盖"却还是报同名已存在**：以前拿拼出来的假路径去删，等于空操作。现在真的覆盖。
- **下载完还显示"下载"按钮**：以前记录里存的是错误的路径，重新进来判定"文件不存在"就把记录删了。现在存的是真实位置，重进直接显示"打开"。

### 打开文件 / 打开目录

- **点「打开文件」报错**：以前用的分享组件只认 `file://`，而我们存的是 `content://`，必然失败。现在改走系统原生打开方式，APK 会直接进安装器。
- **点「打开所在目录」弹「Hermes 想要打开 Google」**：以前没指定类型，系统把请求广播给了所有应用，被 Google 抢走了。现在指定成"目录"类型，只唤起文件管理器；万一系统文件管理器被厂商替换，还有三层备选，最后一层一定能把目录打开。
- **APK 点了装不上**：补上了安装权限。

### 后台

- **App 在后台被系统杀掉、任务中断**：修了前台服务的 5 秒超时崩溃（`ForegroundServiceDidNotStartInTimeException`）。现在的规则是：服务一启动就先声明自己是前台，任何"停"的请求都推后到声明成功之后再执行——因为安卓对每次启动都记账，启动过程中停掉和"从没启动"是同一种违规，照样崩。
- **回到 App 后保活状态是假的**：以前只在启动时探一次，现在每次回前台都重新探活。

### 显示

- 表格太宽被截断 → 可以横向滑动
- 推理强度显示成英文 → 已汉化
- 没登录的模型服务商也出现在列表里 → 已过滤
- 中文缺词条、部分界面中英混杂 → 补齐，并加了 CI 检查，以后缺词条会直接构建失败

### 安装

- **版本号一直停在 13**：这个坑很隐蔽——`android/` 整个目录是构建时自动生成的、不在 git 里，以前改的是那个目录里的文件，等于没改，每次构建又用配置文件重新生成。现在统一从 `app.json` 读，正常递增了。
- **部分手机装不上**：加了 v1 + v2 双签名，兼容各家安装器。

---

## 已知限制

- 手势手感、全屏覆盖效果、各家自启动页是否还能跳对，只能真机验证。
- 厂商的页面会随系统更新改名，代码里做了探测和降级，但如果哪天彻底改了，可能退回到应用详情页。

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
