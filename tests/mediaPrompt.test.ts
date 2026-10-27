import { describe, expect, it } from 'vitest'

import { CAPABILITY_MARKER, MEDIA_CAPABILITY_PROMPT, stripCapability, withMediaCapabilityPrompt } from '@/lib/mediaPrompt'

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

  it('[TC-MEDIA-08] 提示词里不得硬编码任何路径前缀', () => {
    // 写死 /opt/data 或 /home 之类，换个部署就指向不存在的目录
    for (const bad of ['/opt/data', '/home/', 'C:\\', '~/.']) {
      expect(MEDIA_CAPABILITY_PROMPT.includes(bad)).toBe(false)
    }
    expect(MEDIA_CAPABILITY_PROMPT).toContain('不要假设前缀')
  })
})

describe('MediaPrompt: 工作区路径来自服务端', () => {
  it('[TC-MEDIA-09] 传入真实 cwd 时示例使用它', () => {
    const out = withMediaCapabilityPrompt('hi', true, '/srv/agent/workspace')
    expect(out).toContain('/srv/agent/workspace/reports/notes.md')
    expect(out).toContain('当前会话工作区是 /srv/agent/workspace')
  })

  it('[TC-MEDIA-10] 拿不到 cwd 时不给示例，绝不编造路径', () => {
    const out = withMediaCapabilityPrompt('hi', true, null)
    expect(out.includes('/opt/data')).toBe(false)
    expect(out.includes('reports/notes.md')).toBe(false)
    expect(out).toContain('不要假设前缀')
  })

  it('[TC-MEDIA-11] 尾部斜杠不会拼出双斜杠', () => {
    const out = withMediaCapabilityPrompt('hi', true, '/srv/ws/')
    expect(out).toContain('MEDIA:/srv/ws/reports/notes.md')
    expect(out.includes('//reports')).toBe(false)
  })
})

describe('MediaPrompt: 渲染剥离', () => {
  it('[TC-MEDIA-12] 用户文本拼上能力说明后，剥离回来只剩原文', () => {
    const sent = withMediaCapabilityPrompt('写个文件给我', true, '/srv/ws')
    expect(sent).toContain(CAPABILITY_MARKER)
    expect(stripCapability(sent)).toBe('写个文件给我')
  })

  it('[TC-MEDIA-13] 没有标记的文本原样返回，不会误伤正常对话', () => {
    expect(stripCapability('普通消息')).toBe('普通消息')
    expect(stripCapability('')).toBe('')
  })

  it('[TC-MEDIA-14] 剥离是幂等的（本地气泡与历史加载各剥一次）', () => {
    const once = stripCapability(withMediaCapabilityPrompt('hi', true, null))
    expect(stripCapability(once)).toBe(once)
  })

  it('[TC-MEDIA-15] 非首轮不带标记', () => {
    expect(withMediaCapabilityPrompt('第二轮', false, '/srv/ws')).toBe('第二轮')
  })
})
