# Phase 2 代码与实现双审报告 (Code Review)

## 一、 审查概要与评审依据

- **审查对象**：`src/lib/downloadManager.ts`、`src/app/viewer.tsx`、`tests/download.test.ts`、`scripts/verify-fixes.mjs`
- **对照基准**：
  - `docs/changes/2026-10-26_download_experience/contract.md`
  - `docs/changes/2026-10-26_download_experience/tech-design.md`
- **审查角色**：高级代码审查专家 (Reviewer)
- **审查结论**：**有条件通过 (Conditional Pass)**。核心业务解耦与流式直写架构优秀，符合零内存 Base64 红线；但发现 2 个中严重度问题（重进存在性探测遗漏、私有缓存临时文件未清理）和 2 个低严重度隐患（连点重入锁、SAF删除兼容性），需在 Phase 3 验收前完成定点修复。

---

## 二、 重点排查维度审查结论

### 1. 状态生命周期与异步回调 (isMountedRef 与内存泄漏)
- **实现核查** (`src/app/viewer.tsx:105-111, 261, 288, 321, 328`)：
  - 组件通过 `isMountedRef` 在挂载时置 `true`，卸载时置 `false`。
  - `onProgress` 进度回调在首行即执行 `if (!isMountedRef.current) return`，在用户中途退出页面时立即截断 UI 状态分发。
  - 异步任务落盘完成与异常捕获时的 `setState` 操作均包裹在 `if (isMountedRef.current)` 条件内。
- **排查结论**：无卸载组件引发的 React 内存泄漏与 Bridge 报错风险，生命周期管理基本健壮。但前置选目录与弹窗交互期间缺少前置挂载防护，存在连点重入隐患（详见问题清单 #3）。

### 2. SAF 写入与覆盖机制 (删除同名文件的健壮性)
- **实现核查** (`src/app/viewer.tsx:299-308`)：
  - 当用户选择【覆盖】时，代码通过 `new File(targetDir, fileName)` 并在其存在时调用 `delete()`，随后执行 `downloadedLocalFile.copy(finalDestFile)`。
  - 此逻辑成功规避了 Android 原生 `DocumentFile.createFile()` 自动生成 `(1)` 副本的硬编码行为。
- **排查结论**：核心逻辑成立。但对照 `contract.md:12` (二、3) 与 `tech-design.md:10` (环节 4) 发现关键遗漏——重进页面时未对已持久化的 `targetUri` 执行 `file.exists` 探测，若用户在系统文件管理器中删除文件，App 重新进入仍会呈现已完成态（详见问题清单 #1）。

### 3. 异常处理与状态机重置 (下载中止、网络报错、资源清理)
- **实现核查** (`src/app/viewer.tsx:283, 327-332`)：
  - 下载任务失败或中止时（`!downloadedLocalFile`），主动抛出异常进入 `catch` 块。
  - `catch` 块安全重置 `setIsDownloading(false)`，并触发 `toastError(e)` 向用户反馈。
- **排查结论**：状态机能正确重置为可重试态。然而下载成功流式落盘后，私有缓存中下载的临时文件未被清理，违背了 `tech-design.md:9` 中承诺的“随后清理临时缓存”，存在存储空间残留风险（详见问题清单 #2）。

### 4. 性能与节流机制 (150ms 节流有效性)
- **实现核查** (`src/app/viewer.tsx:263-278`)：
  - 进度节流：`now - lastThrottleTime > 150 || bytesWritten === totalBytes`。150ms 阈值严格限制了向 React Native Bridge 发送状态更新的频率；同时当已写字节等于总字节时强制刷新，避免 100% 进度被丢帧遗漏。
  - 瞬时速度：采用 `timeDiff >= 400` 间隔计算，平抑了网速瞬时抖动。
- **排查结论**：节流逻辑高度有效，算法为纯算力无额外对象分配，性能达标。

---

## 三、 审查问题清单 (Review Findings)

| # | 类型 | 问题描述 | 引用位置 | 严重度 | 是否解决 | 解决建议 / 修复方案 |
|---|------|---------|---------|--------|---------|-------------------|\n| 1 | 契约偏差 | **重进页面未执行已落盘文件的本地物理存在性（exists）校验**<br>契约 `contract.md:12` 及 `tech-design.md:10` 明确要求“若用户在系统文件管理器中删除文件，App 重新进入该页面时，exists 校验失败并安全回退至未下载态”。实际代码在 `useEffect` 中仅用 `safeParseDownloadRecord` 校验了 JSON 格式，未验证 `new File(record.targetUri).exists`，导致外部删除后仍假死在完成态。 | `src/app/viewer.tsx:117-123`<br>`contract.md:12`<br>`tech-design.md:10` | 高 | ❌ 待修复 | 在 `useEffect` 中解析出 record 后，通过 `new File(record.targetUri).exists` 检查；若已不存在，调用 `AsyncStorage.removeItem(key)` 并保持 `downloadRecord` 为 `null`。 |
| 2 | 资源泄漏 | **流式落盘至 SAF 外部目录后未清理私有缓存中的临时下载副本**<br>`tech-design.md:9` 环节 3 确证方案承诺“下载完成后通过底层 NIO localFile.copy(targetDir) 写入 SAF 目录，随后清理临时缓存”。代码在 `copy` 完成后遗漏了 `downloadedLocalFile.delete()`，百兆大文件会导致内部缓存长期双倍占用。 | `src/app/viewer.tsx:308-320`<br>`tech-design.md:9` | 中 | ❌ 待修复 | 在 `downloadedLocalFile.copy(finalDestFile)` 落盘成功后，立即执行 `try { if (downloadedLocalFile.exists) downloadedLocalFile.delete() } catch {}` 清理临时文件。 |
| 3 | 边界遗漏 | **前置选目录与冲突确认弹窗期间未置位 `isDownloading` 导致连点重入**<br>`setIsDownloading(true)` 延迟在第 242 行启动下载任务前才调用，在第 179 行目录选择器与 206 行同名弹窗挂起等待期间，`isDownloading` 仍为 `false`，用户连点 HeaderRight 会重复唤起弹窗。 | `src/app/viewer.tsx:172`<br>`src/app/viewer.tsx:242` | 低 | ❌ 待修复 | 在 `startDownloadAndExport` 顶部增加执行锁或立即置位，在用户取消选目录/取消覆盖时显式重置。 |
| 4 | 风险发现 | **SAF 覆盖删除时直接以 `new File(targetDir, fileName)` 构造对象存在特殊 Provider 寻址失败风险**<br>部分定制 Android 系统的 DocumentProvider 对树状 URI 子节点寻址有编码差异，`targetDir.list()` 返回的已包含真实 content URI，直接根据 `name` 匹配的原 entry 执行删除更稳健。 | `src/app/viewer.tsx:301-303` | 低 | ❌ 待修复 | 记录冲突时在 `entries` 中找到的匹配对象，覆盖时优先对其调用 `.delete()`。 |

---

## 四、 裁决意见与后续行动

1. **整体裁决**：**有条件通过 (Conditional Pass)**
   - 核心亮点：代码结构清晰，严格遵循工程纪律完成 UI 与纯函数解耦，单测覆盖 12 种边界场景，无 mock 假测试，零内存 Base64 铁律 100% 达成并通过静态 AST 门禁。
   - 阻断项修复要求：问题 #1（重进存在性探测）和问题 #2（私有临时缓存清理）属于明确违背契约或产生存储残留的问题，必须在进入最终总结前完成代码修正与回归。
2. **行动项**：
   - 实施针对问题 #1 与 #2 的定点修复；
   - 增补对应单测或验证断言，确保 100% 满足 `contract.md` 验收标准。
