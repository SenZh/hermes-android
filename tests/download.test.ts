import { describe, expect, it } from 'vitest'

// 真实 import 生产代码模块，严禁循环自证
import {
  calculateDownloadSpeed,
  getDownloadStorageKey,
  inferMimeType,
  isPickerCancelled,
  pickCreatedEntry,
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

describe('DownloadManager: pickCreatedEntry', () => {
  const entry = (name: string, uri: string) => ({ name, uri })

  it('[TC-DL-13] 普通落盘：认领新增的同名条目', () => {
    const picked = pickCreatedEntry(
      ['old.txt'],
      [entry('old.txt', 'content://d/old'), entry('app.apk', 'content://d/app')],
      'app.apk',
    )
    expect(picked?.uri).toBe('content://d/app')
  })

  it('[TC-DL-14] 覆盖写回：名字原本就存在时仍认领该名字', () => {
    const picked = pickCreatedEntry(
      ['app.apk'],
      [entry('app.apk', 'content://d/app-v2')],
      'app.apk',
    )
    expect(picked?.uri).toBe('content://d/app-v2')
  })

  it('[TC-DL-19] 名字匹配优先于“新增条目”启发式，防止外部写入被误认领', () => {
    // 覆盖写回时同名条目一直在，同时外部程序写入了 extra.txt：
    // 必须认领同名条目，不能因为"多了一个新条目"就认领 extra.txt
    const picked = pickCreatedEntry(
      ['app.apk'],
      [entry('app.apk', 'content://d/app-v2'), entry('extra.txt', 'content://d/extra')],
      'app.apk',
    )
    expect(picked?.uri).toBe('content://d/app-v2')
  })

  it('[TC-DL-20] 新增多个条目且名字对不上时返回 null', () => {
    expect(
      pickCreatedEntry(
        ['a'],
        [entry('a', 'content://d/a'), entry('b', 'content://d/b'), entry('c', 'content://d/c')],
        'd',
      ),
    ).toBeNull()
  })

  it('[TC-DL-16] 空目录：只有一个条目时直接认领', () => {
    const picked = pickCreatedEntry([], [entry('app.apk', 'content://d/app')], 'other.apk')
    expect(picked?.uri).toBe('content://d/app')
  })

  it('[TC-DL-17] 无法判定：没有名字匹配也没有唯一新增时返回 null', () => {
    expect(pickCreatedEntry(['a'], [entry('a', 'content://d/a')], 'b')).toBeNull()
  })

  it('[TC-DL-18] 空名字条目被忽略，不参与认领', () => {
    const picked = pickCreatedEntry([], [{ name: null, uri: 'content://d/x' }, entry('k.txt', 'content://d/k')], 'k.txt')
    expect(picked?.uri).toBe('content://d/k')
  })
})

describe('DownloadManager: isPickerCancelled', () => {
  it('[TC-DL-21] 识别 expo 选择器取消异常', () => {
    expect(isPickerCancelled(new Error('The file picker was cancelled by the user'))).toBe(true)
    expect(isPickerCancelled({ code: 'ERR_PICKER_CANCELLED' })).toBe(true)
    expect(isPickerCancelled({ code: 'ERR_PICKER_CANCELED', message: '' })).toBe(true)
  })

  it('[TC-DL-22] 真实错误不被误判为取消', () => {
    expect(isPickerCancelled(new Error('Destination already exists'))).toBe(false)
    expect(isPickerCancelled({ code: 'ERR_UNKNOWN', message: 'Unable to copy file or directory' })).toBe(false)
    expect(isPickerCancelled(null)).toBe(false)
    expect(isPickerCancelled(undefined)).toBe(false)
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

describe('DownloadManager: inferMimeType', () => {
  it('[TC-DL-23] 精确推断 APK 安装包类型', () => {
    expect(inferMimeType('hermes-preview.apk')).toBe('application/vnd.android.package-archive')
    expect(inferMimeType('APP.APK', 'application/octet-stream')).toBe('application/vnd.android.package-archive')
  })

  it('[TC-DL-25] APK 的扩展名必须压过服务端的错误声明', () => {
    // 服务端把 apk 标成 text/plain 很常见；信了它就调不起系统安装器
    expect(inferMimeType('app.apk', 'text/plain')).toBe('application/vnd.android.package-archive')
    expect(inferMimeType('app.apk', 'application/zip')).toBe('application/vnd.android.package-archive')
  })

  it('[TC-DL-24] 保留服务器已知合法类型，补齐常见文档与媒体类型', () => {
    expect(inferMimeType('doc.pdf')).toBe('application/pdf')
    expect(inferMimeType('archive.zip')).toBe('application/zip')
    expect(inferMimeType('photo.png')).toBe('image/png')
    expect(inferMimeType('custom.bin', 'application/custom')).toBe('application/custom')
    expect(inferMimeType('unknown.xyz')).toBe('*/*')
  })
})
