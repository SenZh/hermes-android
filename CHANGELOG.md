# 更新日志 (Changelog)

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
