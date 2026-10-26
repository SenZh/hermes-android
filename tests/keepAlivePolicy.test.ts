import { describe, expect, it } from 'vitest'

// 真实 import 生产代码模块，严禁在测试里重写一份逻辑自证
import { STOP_COOLDOWN_MS, canStartNow, nextBackoffMs } from '@/lib/keepAlivePolicy'

describe('KeepAlivePolicy: canStartNow', () => {
  it('[TC-KA-07] 停服后不足冷却期时拒绝投递', () => {
    expect(canStartNow(1000, 900)).toBe(false)
    expect(canStartNow(1199, 900)).toBe(false)
  })

  it('[TC-KA-08] 停服后满足冷却期时允许投递', () => {
    expect(canStartNow(1200, 900)).toBe(true)
    expect(canStartNow(5000, 900)).toBe(true)
  })

  it('[TC-KA-12] 从未停过服时直接允许', () => {
    expect(canStartNow(1000, 0)).toBe(true)
    expect(canStartNow(1000, -1)).toBe(true)
  })

  it('[TC-KA-13] 自定义冷却时长生效', () => {
    expect(canStartNow(200, 100, 100)).toBe(true)
    expect(canStartNow(150, 100, 100)).toBe(false)
    expect(canStartNow(150, 100, 200)).toBe(false)
    // 冷却为 0 或负数等价于不设冷却（防御配置错误）
    expect(canStartNow(100, 100, 0)).toBe(true)
    expect(canStartNow(100, 100, -5)).toBe(true)
  })

  it('[TC-KA-19] 默认冷却常量为 300ms', () => {
    expect(STOP_COOLDOWN_MS).toBe(300)
  })

  it('[TC-KA-20] 时钟回拨时安全拒绝（不因负差值误判放行）', () => {
    expect(canStartNow(900, 1000)).toBe(false)
  })
})

describe('KeepAlivePolicy: nextBackoffMs', () => {
  it('[TC-KA-09] 连续失败时指数翻倍', () => {
    expect(nextBackoffMs(1)).toBe(1000)
    expect(nextBackoffMs(2)).toBe(2000)
    expect(nextBackoffMs(3)).toBe(4000)
    expect(nextBackoffMs(4)).toBe(8000)
    expect(nextBackoffMs(5)).toBe(16000)
  })

  it('[TC-KA-10] 退避封顶 30 秒', () => {
    expect(nextBackoffMs(6)).toBe(30000)
    expect(nextBackoffMs(20)).toBe(30000)
    expect(nextBackoffMs(99)).toBe(30000)
  })

  it('[TC-KA-11] 没有失败时不等待', () => {
    expect(nextBackoffMs(0)).toBe(0)
    expect(nextBackoffMs(-1)).toBe(0)
  })

  it('[TC-KA-13b] 自定义基数与上限生效', () => {
    expect(nextBackoffMs(1, 500, 2000)).toBe(500)
    expect(nextBackoffMs(3, 500, 2000)).toBe(2000)
    expect(nextBackoffMs(3, 500, 10_000)).toBe(2000)
    expect(nextBackoffMs(1, 0, 2000)).toBe(0)
    expect(nextBackoffMs(1, 500, 0)).toBe(0)
  })

  it('[TC-KA-21] 非有限数入参安全返回 0', () => {
    expect(nextBackoffMs(Number.NaN)).toBe(0)
    expect(nextBackoffMs(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
