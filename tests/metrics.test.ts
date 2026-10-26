import { describe, expect, it } from 'vitest'

// 直接 import 真实的生产业务模块，消除“循环自证”
import { calculateTps, formatDuration } from '@/lib/metrics'

describe('Metrics: formatDuration (Real Module)', () => {
  it('formats milliseconds to concise Chinese duration', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(undefined)).toBeNull()
    expect(formatDuration(500)).toBeNull() // < 1s 忽略
    expect(formatDuration(1000)).toBe('1秒')
    expect(formatDuration(23400)).toBe('23秒')
    expect(formatDuration(60000)).toBe('1分钟')
    expect(formatDuration(83000)).toBe('1分23秒')
    expect(formatDuration(3600000)).toBe('60分钟')
  })
})

describe('Metrics: calculateTps (Real Module)', () => {
  it('uses reported TPS first if valid', () => {
    expect(calculateTps(42.56, '任意文本', 2000)).toBe(42.6)
  })

  it('falls back to character estimation when reported TPS is absent', () => {
    // 100个字符 / 2.5 = 40 tokens，耗时 2000ms = 2s => 20 tok/s
    const text100 = '一'.repeat(100)
    expect(calculateTps(undefined, text100, 2000)).toBe(20)
  })

  it('returns null on invalid or negligible duration', () => {
    expect(calculateTps(undefined, '文本', 500)).toBeNull()
    expect(calculateTps(undefined, '', 2000)).toBeNull()
    expect(calculateTps(undefined, null, 2000)).toBeNull()
  })
})
