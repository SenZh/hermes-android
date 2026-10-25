import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({ t: (key: string) => key }))

import { nextRuns, offsetFromIso, offsetLabel } from '@/lib/cron'

describe('offsetFromIso', () => {
  it('reads the offset the server wrote', () => {
    expect(offsetFromIso('2026-10-23T15:00:00+08:00')).toBe(480)
    expect(offsetFromIso('2026-10-23T07:00:00Z')).toBe(0)
    expect(offsetFromIso('2026-10-23T07:00:00')).toBeNull()
    expect(offsetFromIso(null)).toBeNull()
  })
})

describe('nextRuns', () => {
  it('handles interval schedules', () => {
    expect(nextRuns('every 30m', 0, 2, 0)).toEqual([1_800_000, 3_600_000])
  })

  it('computes the next cron instants in the server zone', () => {
    const now = Date.UTC(2026, 9, 23, 7, 1)
    expect(nextRuns('*/15 * * * *', 0, 2, now)).toEqual([
      Date.UTC(2026, 9, 23, 7, 15),
      Date.UTC(2026, 9, 23, 7, 30),
    ])
  })

  it('returns null for schedules it cannot preview', () => {
    expect(nextRuns('tomorrow at 9', 0, 3, 0)).toBeNull()
    expect(nextRuns('* * * *', 0, 3, 0)).toBeNull()
  })
})

describe('offsetLabel', () => {
  it('formats positive, negative and zero offsets', () => {
    expect(offsetLabel(480)).toBe('UTC+8')
    expect(offsetLabel(-330)).toBe('UTC-5:30')
    expect(offsetLabel(0)).toBe('UTC+0')
  })
})
