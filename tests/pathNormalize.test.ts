import { describe, expect, it } from 'vitest'

import { isManagedPath, MANAGED_ROOT, normalizeManagedPath, WORKSPACE_ROOT } from '@/lib/pathNormalize'

describe('PathNormalize: 客户端传入形态', () => {
  it('[TC-PATH-01] 纯相对路径映射到工作区', () => {
    expect(normalizeManagedPath('output/test-client-document.md')).toBe(
      `${WORKSPACE_ROOT}/output/test-client-document.md`,
    )
  })

  it('[TC-PATH-02] 带前导斜杠的相对路径剥掉根斜杠后仍落工作区', () => {
    expect(normalizeManagedPath('/output/test-client-document.md')).toBe(
      `${WORKSPACE_ROOT}/output/test-client-document.md`,
    )
  })

  it('[TC-PATH-03] sandbox: 协议被剥离', () => {
    expect(normalizeManagedPath('sandbox:/output/test.txt')).toBe(`${WORKSPACE_ROOT}/output/test.txt`)
    expect(normalizeManagedPath('sandbox://output/test.txt')).toBe(`${WORKSPACE_ROOT}/output/test.txt`)
  })

  it('[TC-PATH-04] ./ 前缀被剥离', () => {
    expect(normalizeManagedPath('./src/app.tsx')).toBe(`${WORKSPACE_ROOT}/src/app.tsx`)
  })

  it('[TC-PATH-05] 已显式写 workspace/ 的不重复叠加', () => {
    expect(normalizeManagedPath('workspace/notes.md')).toBe(`${MANAGED_ROOT}/workspace/notes.md`)
  })

  it('[TC-PATH-06] 合法受管绝对路径原样保留', () => {
    expect(normalizeManagedPath('/opt/data/images/a.png')).toBe('/opt/data/images/a.png')
    expect(normalizeManagedPath('/opt/data/workspace/b.md')).toBe('/opt/data/workspace/b.md')
  })

  it('[TC-PATH-07] 空输入返回空串，不产生 /opt/data/workspace/ 这种假路径', () => {
    expect(normalizeManagedPath('')).toBe('')
  })

  it('[TC-PATH-08] 首尾空白被裁掉', () => {
    expect(normalizeManagedPath('  output/x.md  ')).toBe(`${WORKSPACE_ROOT}/output/x.md`)
  })
})

describe('PathNormalize: 沙箱校验', () => {
  it('[TC-PATH-09] 规范化结果始终落在受管根内', () => {
    for (const raw of ['a.md', '/a.md', 'sandbox:/a.md', './a.md', 'workspace/a.md']) {
      expect(isManagedPath(normalizeManagedPath(raw))).toBe(true)
    }
  })

  it('[TC-PATH-10] 外部绝对路径会被当作相对路径收进工作区，而不是放行', () => {
    const n = normalizeManagedPath('/etc/passwd')
    expect(n).toBe(`${WORKSPACE_ROOT}/etc/passwd`)
    expect(isManagedPath(n)).toBe(true)
  })
})
