import { describe, expect, it } from 'vitest'

import { zh } from '@/i18n/zh'
import { effortLabel, effortsFor } from '@/lib/reasoning'

describe('effortsFor', () => {
  it('returns no levels when the model cannot reason', () => {
    expect(effortsFor('openai', 'gpt-5', { reasoning: false })).toEqual([])
  })

  it('offers "none" when the wire can disable thinking', () => {
    expect(effortsFor('openai', 'gpt-5')).toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
  })

  it('omits "none" for wires that cannot switch thinking off', () => {
    expect(effortsFor('xai', 'grok-4')).toEqual(['low', 'medium', 'high'])
    expect(effortsFor('meta-ai', 'llama-4')).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
  })

  it('reads the model family through an aggregator prefix', () => {
    expect(effortsFor('openrouter', 'anthropic/claude-sonnet-4-5')).toEqual([
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ])
  })

  it('uses the gpt-6 level set', () => {
    expect(effortsFor('openai-codex', 'gpt-6-astra')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })
})

describe('effortLabel', () => {
  const translate = (key: string) => zh[key] ?? key

  it('maps every effort through the real zh catalog', () => {
    expect(effortLabel('none', translate)).toBe(zh['Off'])
    expect(effortLabel('minimal', translate)).toBe(zh['Minimal'])
    expect(effortLabel('low', translate)).toBe(zh['Low'])
    expect(effortLabel('medium', translate)).toBe(zh['Medium'])
    expect(effortLabel('high', translate)).toBe(zh['High'])
    expect(effortLabel('xhigh', translate)).toBe(zh['Extra high'])
    expect(effortLabel('max', translate)).toBe(zh['Max'])
    expect(effortLabel(null, translate)).toBe(zh['default'])
  })

  it('passes unknown levels through unchanged', () => {
    expect(effortLabel('weird', translate)).toBe('weird')
  })
})
