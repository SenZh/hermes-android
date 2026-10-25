import { describe, expect, it } from 'vitest'

import { effortsFor } from '@/lib/reasoning'

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
