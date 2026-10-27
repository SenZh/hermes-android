import { describe, expect, it } from 'vitest'

import { MEDIA_CAPABILITY_PROMPT, withMediaCapabilityPrompt } from '@/lib/mediaPrompt'

describe('MediaPrompt: 注入时机', () => {
  it('[TC-MEDIA-01] 首轮追加能力说明', () => {
    const out = withMediaCapabilityPrompt('你好', true)
    expect(out).toContain('你好')
    expect(out).toContain('MEDIA:')
    expect(out.endsWith(MEDIA_CAPABILITY_PROMPT)).toBe(true)
  })

  it('[TC-MEDIA-02] 非首轮原样返回，不重复烧 token', () => {
    expect(withMediaCapabilityPrompt('继续', false)).toBe('继续')
  })

  it('[TC-MEDIA-03] 空输入不会被撑成只剩提示词', () => {
    const out = withMediaCapabilityPrompt('', true)
    expect(out.startsWith('\n\n')).toBe(true)
    expect(out).toContain('MEDIA:')
  })
})

describe('MediaPrompt: 提示词内容', () => {
  it('[TC-MEDIA-04] 必须给出 MEDIA: 语法与绝对路径要求', () => {
    expect(MEDIA_CAPABILITY_PROMPT).toContain('MEDIA:/服务端绝对路径')
    expect(MEDIA_CAPABILITY_PROMPT).toContain('绝对路径')
  })

  it('[TC-MEDIA-05] 必须禁止 base64 内联，否则会撑爆上下文/内存', () => {
    expect(MEDIA_CAPABILITY_PROMPT).toContain('base64')
  })

  it('[TC-MEDIA-06] 必须声明「用户看不到这段」，避免模型在正文里提它', () => {
    expect(MEDIA_CAPABILITY_PROMPT).toContain('用户看不到')
  })

  it('[TC-MEDIA-07] 必须覆盖图片、PDF、Markdown 三类常见交付物', () => {
    for (const kind of ['图片', 'PDF', 'Markdown']) {
      expect(MEDIA_CAPABILITY_PROMPT).toContain(kind)
    }
  })
})
