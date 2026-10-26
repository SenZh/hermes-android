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
 * 纯函数：生成持久化存储的 Key
 */
export function getDownloadStorageKey(path: string): string {
  const sanitized = path.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+/, '')
  return `hermes_dl_${sanitized}`
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
