import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({ t: (key: string) => key }))

import {
  dropKnownRows,
  isSilentReply,
  isToolError,
  previewText,
  splitRefs,
  stripCronPreamble,
} from '@/lib/chat/history'

describe('isToolError', () => {
  it('recognises the error shapes the gateway returns', () => {
    expect(isToolError({ error: 'boom' })).toBe(true)
    expect(isToolError({ exit_code: 2 })).toBe(true)
    expect(isToolError({ success: false })).toBe(true)
    expect(isToolError({ ok: false })).toBe(true)
  })

  it('treats a clean result as success', () => {
    expect(isToolError({ exit_code: 0 })).toBe(false)
    expect(isToolError({ ok: true })).toBe(false)
    expect(isToolError(null)).toBe(false)
    expect(isToolError('boom')).toBe(false)
  })
})

describe('stripCronPreamble', () => {
  it('drops a balanced preamble, including nested brackets', () => {
    const raw = '[IMPORTANT: You are running as a scheduled cron job. keep [SILENT] quiet]\n\nHello'
    expect(stripCronPreamble(raw)).toEqual({ text: 'Hello', stripped: true })
  })

  it('drops a mid-message cron hint without eating the content around it', () => {
    const raw = 'skill output\n\n[IMPORTANT: You are running as a scheduled cron job. do the thing]\n\nDone'
    expect(stripCronPreamble(raw).text).toBe('skill output\n\nDone')
  })

  it('leaves ordinary text alone', () => {
    expect(stripCronPreamble('hello')).toEqual({ text: 'hello', stripped: false })
  })
})

describe('history paging and previews', () => {
  it('drops rows at or past the cutoff, and keeps rows without an id', () => {
    expect(dropKnownRows([{ id: 3 }, { id: 2 }, { id: 1 }], 2)).toEqual([{ id: 1 }])
    expect(dropKnownRows([{ id: 1 }], null)).toEqual([{ id: 1 }])
    expect(dropKnownRows([{ id: undefined }, { id: 5 }], 5)).toEqual([{ id: undefined }])
  })

  it('describes a silent cron reply instead of showing the marker', () => {
    expect(isSilentReply(' [SILENT] ')).toBe(true)
    expect(previewText('[SILENT]')).toBe('Nothing new to report — the job stayed silent.')
    expect(previewText('[IMPORTANT: truncated')).toBe('')
    expect(previewText('hello')).toBe('hello')
    expect(previewText(null)).toBe('')
  })

  it('pulls attachment references out of a user turn', () => {
    expect(splitRefs('hi\n@image:/tmp/a.png\n@file:/tmp/b.pdf\nbye')).toEqual({
      text: 'hi\nbye',
      images: ['/tmp/a.png'],
      files: ['/tmp/b.pdf'],
    })
  })
})
