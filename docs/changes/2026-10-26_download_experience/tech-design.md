# 技术设计与环节可行性证明 (Technical Design) - v2 修正版

## 一、 环节可行性证明矩阵 (Feasibility Proof Matrix)

| 步骤 | 环节设计 | 隐性假设 | 确证事实与代码依据 (S/A级源码取证) | 风险结论 |
| :--- | :--- | :--- | :--- | :--- |
| 1. 前置选目录 | `Directory.pickDirectoryAsync()` | 用户取消时能否静默中断不产生网络流量 | 源码 `Directory.ts:106`：用户取消时返回空对象或未授权，判断 `!picked?.uri` 立即 `return`，完全在网络下载发起之前执行，绝不浪费流量。 | 假设清零，事实成立 |
| 2. 同名冲突检测与决策 | 读取目标目录枚举已有文件 | SAF 目录能否读取已有文件；覆盖时能否直接覆写 | 源码 `FileSystemLegacyModule.kt:449`：Android 原生 `DocumentFile.createFile()` 遇到同名文件时**会自动追加 `(1)` 变成新文件**。因此，若用户在弹窗中选择【覆盖】，必须**先执行 `existingFile.delete()` 删除同名旧文件**，再进行文件创建/写入，方能达成真正的覆写效果！ | 假设清零，事实确证 |
| 3. 流式下载与进度速度 | 两段式安全流式管道 | 能否将网络流直写 SAF 且带进度 | **证伪排雷**：Android 原生 `FileSystemPath.kt:80` 明确声明 `if (uri.isContentUri) throw Exception("This method cannot be used with content URIs")`，禁止将 SAF content URI 直接传给 `downloadAsync`（且 URL 后缀会导致文件名变成固定 `"download"`）。**确证方案**：采用成熟两阶段管道——通过 `File.createDownloadTask` 流式直写私有安全缓存 `Paths.cache`（带 150ms 节流的 `bytesWritten`、`totalBytes` 进度与瞬时网速计算），下载完成后通过底层 NIO `localFile.copy(targetDir)` 写入 SAF 目录，随后清理临时缓存。全程零 JS Base64，零 OOM 风险！ | 假设清零，事实确证 |
| 4. 状态持久化与重进识别 | `AsyncStorage` 记录已落盘文件信息 | 退出重进后能否重新校验并防白屏 | 在 `AsyncStorage` 写入 `hermes_dl_${key}`，包含 `{ targetUri, fileName, targetFolder, downloadedAt }`。重进组件 `useEffect` 解析时增加完整 try-catch 与 `new File(targetUri).exists` 探测。若用户在外部删除了文件，静默清除缓存并回退至未下载态，绝不白屏。 | 假设清零，事实成立 |
| 5. 打开文件/打开目录 | 原生 Intent 调起 | Android 能否打开文件与打开 SAF 目录 | 1. **打开文件**：通过 `Sharing.shareAsync(localFile.uri, { mimeType })` 或原生 Activity 调起对应宿主应用（APK安装器、文本阅读器）；2. **打开所在目录**：通过 `Linking.openURL(targetDirUri)` 调起 Android 原生 DocumentsUI 查看器，直接聚焦对应目录。 | 假设清零，事实成立 |

---

## 二、 方案对比表 (Alternative Options)

| 方案 | 描述 | 优点 | 缺点 | 风险 | 推荐理由 / 不选理由 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **方案 A：单体文件全写在 viewer.tsx 内部** | 在页面组件内堆砌状态、进度计算、冲突判定、持久化逻辑 | 无需新建文件 | 组件代码极度臃肿（超过 500 行），逻辑与 UI 耦合无法写独立单测，必死于循环自证 | 无法单测，易发回归 | ❌ 不选：违背测试解耦铁律 |
| **方案 B（选）：抽取 `src/lib/downloadManager.ts` 独立状态机** | 将进度计算、网速换算、重命名防重、冲突决策、持久化解耦为纯逻辑库 | 1. 纯逻辑可编写 100% 覆盖率的真实 Vitest 单测；2. UI 极度干净；3. 状态一致性保证 | 需额外引入类型与测试文件 | 极低 | ✅ 推荐：逻辑与 UI 彻底分离，测试先行 |

---

## 三、 详细架构与接口设计

### 1. 独立业务逻辑模块 `src/lib/downloadManager.ts`
```typescript
export interface DownloadState {
  status: 'idle' | 'picking' | 'downloading' | 'completed' | 'error'
  progress: number // 0 - 100
  bytesWritten: number
  totalBytes: number
  speedText: string // e.g. "4.2 MB/s"
  targetUri?: string
  targetFolder?: string
  fileName?: string
  error?: string
}

export interface StoredDownloadRecord {
  targetUri: string
  fileName: string
  targetFolder: string
  downloadedAt: number
  fileSize: number
}

// 纯函数：解决同名冲突自增
export function resolveFileNameConflict(
  fileName: string,
  existingFiles: string[],
  action: 'overwrite' | 'rename'
): string

// 纯函数：瞬时网速换算
export function calculateDownloadSpeed(
  prevBytes: number,
  currentBytes: number,
  timeElapsedMs: number
): string

// 纯函数：存储 key 生成
export function getDownloadStorageKey(path: string): string

// 纯函数：安全反序列化持久化记录
export function safeParseDownloadRecord(raw: string | null): StoredDownloadRecord | null
```

### 2. UI 渲染与同名冲突交互流
- **点击【下载到设备】**：
  1. 调用 `Directory.pickDirectoryAsync()`；用户若取消，流程静默终止，无任何网络请求；
  2. 获取目标目录列表；若发现同名文件，通过 `confirm` 呼出决策弹窗：
     - **【覆盖】**：记录覆盖标记，下载完成后先删除同名目标，再执行流式拷贝；
     - **【自动重命名】**：通过 `resolveFileNameConflict` 自动计算新名字（如 `app (1).apk`）；
     - **【取消】**：终止流程。
  3. 启动 `createDownloadTask` 流式下载至私有缓存（150ms 节流上报进度、已下载大小与网速）；
  4. 下载完毕流式 copy 写入外部 SAF 目录；
  5. 写入持久化记录，UI 切换为完成态。
- **UI 状态呈现**：
  - **未下载时**：下方卡片展示【下载到本地】或【下载并预览】；
  - **下载中**：下方卡片展示水平进度条、百分比、大小（如 `23.5 MB / 82.0 MB`）、瞬时速度（`4.5 MB/s`）；
  - **已下载 / 重进识别已下载**：
    - 下方卡片展示：绿色已完成图标、落盘目录（如 `已保存到 Downloads：app.apk`）以及双按钮：【📄 打开文件】与【📁 打开所在目录】；
    - 右上角 HeaderRight 保持同步联动。
