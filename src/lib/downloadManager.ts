/**
 * Download Manager: Pure business logic for file downloading, progress tracking,
 * conflict resolution and state persistence.
 */

export interface DownloadProgressInfo {
  bytesWritten: number
  totalBytes: number
  progress: number // 0 - 100
  speedText: string
}

export interface StoredDownloadRecord {
  targetUri: string
  fileName: string
  targetFolder: string
  downloadedAt: number
  fileSize: number
}

/**
 * 纯函数：解决同名文件冲突。
 * 若选择 rename，则自动在扩展名前追加 (1), (2) 等自增编号。
 */
export function resolveFileNameConflict(
  fileName: string,
  existingFiles: string[],
  action: 'overwrite' | 'rename',
): string {
  if (action === 'overwrite' || !existingFiles.includes(fileName)) {
    return fileName
  }

  // 分离文件名与扩展名（优先识别 .tar.gz 等常见复合双扩展名）
  let baseName = fileName
  let ext = ''

  if (/\.tar\.(gz|bz2|xz)$/i.test(fileName)) {
    const idx = fileName.toLowerCase().indexOf('.tar.')
    baseName = fileName.slice(0, idx)
    ext = fileName.slice(idx)
  } else {
    const dotIndex = fileName.lastIndexOf('.')
    if (dotIndex > 0) {
      baseName = fileName.slice(0, dotIndex)
      ext = fileName.slice(dotIndex)
    }
  }

  // 去除已有的类似 " (1)" 的后缀以便正确自增
  const cleanBaseName = baseName.replace(/\s\(\d+\)$/, '')

  let counter = 1
  let candidate = `${cleanBaseName} (${counter})${ext}`
  while (existingFiles.includes(candidate)) {
    counter++
    candidate = `${cleanBaseName} (${counter})${ext}`
  }

  return candidate
}

/**
 * 纯函数：计算并格式化瞬时下载速度。
 */
export function calculateDownloadSpeed(
  prevBytes: number,
  currentBytes: number,
  timeElapsedMs: number,
): string {
  if (timeElapsedMs <= 0 || currentBytes < prevBytes) {
    return '0 KB/s'
  }

  const bytesDelta = currentBytes - prevBytes
  const seconds = timeElapsedMs / 1000
  const bytesPerSec = bytesDelta / seconds

  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  }
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
}

/**
 * 纯函数：根据文件名推断准确的 MIME 类型（支持 APK 原生安装、PDF、压缩包等）。
 */
export function inferMimeType(fileName: string, serverMime?: string): string {
  if (serverMime && serverMime !== 'application/octet-stream' && serverMime !== '*/*') {
    return serverMime
  }
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.apk')) return 'application/vnd.android.package-archive'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.zip')) return 'application/zip'
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.json')) return 'application/json'
  return serverMime || '*/*'
}

/**
 * 纯函数：生成持久化存储的 Key
 */
export function getDownloadStorageKey(path: string): string {
  const sanitized = path.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '')
  return `hermes_dl_${sanitized}`
}

export interface SafEntryLike {
  name: string | null
  uri: string
}

/**
 * 纯函数：在 copy 完成后定位真实落盘的 SAF 子条目。
 *
 * SAF 目录下 `new File(dir, name)` 拼出的是**伪子 URI**（Tree URI + 路径段），
 * 真实文件是 `content://.../document/<docId>` 形式，两者对不上。所以落盘后
 * 必须回到目录 list() 里按"新增条目"认领真实 URI，否则持久化记录指向一个
 * 不存在的 URI，重进页面 exists 恒为 false，下载完成态会永远丢失。
 *
 * 三种情形依次兜底：
 * 1. 名字匹配且是新增条目（普通落盘）
 * 2. 名字匹配但原本就存在（overwrite 覆盖写回）
 * 3. 名字不匹配但出现了新增条目（SAF 自己加了 " (1)" 之类后缀）
 */
export function pickCreatedEntry(
  beforeNames: readonly string[],
  after: readonly SafEntryLike[],
  wantedName: string,
): SafEntryLike | null {
  const before = new Set(beforeNames)
  const named = (e: SafEntryLike) => e.name !== null && e.name === wantedName

  // 1. 名字匹配优先。走 Directory 作目标的 copy 时，native 会先删同名再重建，名字不变，
  //    所以这是常态路径，也避免"外部程序恰好写入一个文件"被误认领。
  const match = after.find(named)
  if (match) return match

  // 2. 名字对不上但只多出一个条目：只能是 SAF 自己改了名
  const added = after.filter((e) => e.name !== null && !before.has(e.name))
  return added.length === 1 ? added[0] : null
}

/**
 * 纯函数：判断一个异常是否"用户在系统选择器里点了取消"。
 *
 * expo 的 pickDirectoryAsync 在取消时抛 PickerCancelledException（message 为
 * "The file picker was cancelled by the user"），不是返回 null —— 不识别它就会把
 * 用户的正常取消当成错误弹给用户。
 */
export function isPickerCancelled(error: unknown): boolean {
  if (!error) return false
  const e = error as { code?: unknown; message?: unknown }
  const code = typeof e.code === 'string' ? e.code : ''
  const message = typeof e.message === 'string' ? e.message : String(error)
  return /cancel/i.test(code) || /cancel/i.test(message)
}

/**
 * 纯函数：安全解析持久化下载记录（防御脏数据）
 */
export function safeParseDownloadRecord(raw: string | null | undefined): StoredDownloadRecord | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.targetUri === 'string' &&
      typeof parsed.fileName === 'string' &&
      typeof parsed.targetFolder === 'string' &&
      typeof parsed.downloadedAt === 'number'
    ) {
      return {
        targetUri: parsed.targetUri,
        fileName: parsed.fileName,
        targetFolder: parsed.targetFolder,
        downloadedAt: parsed.downloadedAt,
        fileSize: typeof parsed.fileSize === 'number' ? parsed.fileSize : 0,
      }
    }
    return null
  } catch {
    return null
  }
}
