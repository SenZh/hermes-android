import { describe, expect, it } from 'vitest'

// 真实 import 生产代码模块，严禁循环自证
import {
  calculateDownloadSpeed,
  getDownloadStorageKey,
  resolveFileNameConflict,
  safeParseDownloadRecord,
} from '@/lib/downloadManager'

describe('DownloadManager: resolveFileNameConflict', () => {
  it('[TC-DL-01] 无冲突时保留原名', () => {
    expect(resolveFileNameConflict('app.apk', ['other.txt', 'music.mp3'], 'rename')).toBe('app.apk')
  })

  it('[TC-DL-02] 存在同名文件且选择重命名时，生成 (1) 后缀', () => {
    expect(resolveFileNameConflict('app.apk', ['app.apk'], 'rename')).toBe('app (1).apk')
  })

  it('[TC-DL-03] 存在多个重名时，自增数字编号', () => {
    expect(resolveFileNameConflict('app.apk', ['app.apk', 'app (1).apk'], 'rename')).toBe('app (2).apk')
  })

  it('[TC-DL-04] 用户选择覆盖 (overwrite) 时，始终返回原文件名', () => {
    expect(resolveFileNameConflict('app.apk', ['app.apk', 'app (1).apk'], 'overwrite')).toBe('app.apk')
  })

  it('[TC-DL-09] 正确处理多重后缀与已有括号命名', () => {
    expect(
      resolveFileNameConflict('report (1).tar.gz', ['report (1).tar.gz'], 'rename'),
    ).toBe('report (2).tar.gz')
  })
})

describe('DownloadManager: calculateDownloadSpeed', () => {
  it('[TC-DL-05] 速度精确换算至 MB/s', () => {
    expect(calculateDownloadSpeed(0, 1024 * 1024 * 2.5, 1000)).toBe('2.5 MB/s')
  })

  it('[TC-DL-06] 小数据量精确换算至 KB/s', () => {
    expect(calculateDownloadSpeed(0, 1024 * 350, 1000)).toBe('350.0 KB/s')
  })

  it('[TC-DL-07] 异常耗时或回退数据安全保底', () => {
    expect(calculateDownloadSpeed(100, 50, 1000)).toBe('0 KB/s')
    expect(calculateDownloadSpeed(0, 100, 0)).toBe('0 KB/s')
    expect(calculateDownloadSpeed(0, 100, -100)).toBe('0 KB/s')
  })
})

describe('DownloadManager: getDownloadStorageKey', () => {
  it('[TC-DL-08] 规范化生成持久化 key', () => {
    expect(getDownloadStorageKey('/opt/data/workspace/output/test.apk')).toBe(
      'hermes_dl_opt_data_workspace_output_test_apk',
    )
  })
})

describe('DownloadManager: safeParseDownloadRecord', () => {
  it('[TC-DL-10] 损坏脏 JSON 安全返回 null 不崩溃', () => {
    expect(safeParseDownloadRecord('invalid json {;;}')).toBeNull()
    expect(safeParseDownloadRecord(null)).toBeNull()
    expect(safeParseDownloadRecord('')).toBeNull()
  })

  it('[TC-DL-11] 缺少关键字段时返回 null', () => {
    const incomplete = JSON.stringify({ fileName: 'test.apk' })
    expect(safeParseDownloadRecord(incomplete)).toBeNull()
  })

  it('[TC-DL-12] 字段完整时成功解析对象', () => {
    const valid = JSON.stringify({
      targetUri: 'content://com.android.externalstorage/tree/downloads/test.apk',
      fileName: 'test.apk',
      targetFolder: 'Downloads',
      downloadedAt: 1730000000000,
      fileSize: 1048576,
    })
    const res = safeParseDownloadRecord(valid)
    expect(res).not.toBeNull()
    expect(res?.fileName).toBe('test.apk')
    expect(res?.targetFolder).toBe('Downloads')
    expect(res?.fileSize).toBe(1048576)
  })
})
