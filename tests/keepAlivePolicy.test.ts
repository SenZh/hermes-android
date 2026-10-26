import { describe, expect, it } from 'vitest'

// 真实 import 生产代码模块，严禁在测试里重写一份逻辑自证
import { STOP_COOLDOWN_MS, canStartNow, decideStart, nextBackoffMs } from '@/lib/keepAlivePolicy'

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

describe('KeepAlivePolicy: decideStart', () => {
  const base = { running: false, foreground: true, now: 10_000, lastStopAt: 0, retryAfter: 0 }

  it('[TC-KA-22] 前后台正常且无阻挡时允许投递', () => {
    expect(decideStart(base)).toEqual({ action: 'start' })
  })

  it('[TC-KA-23] 已在运行时不再投递', () => {
    expect(decideStart({ ...base, running: true })).toEqual({ action: 'skip', reason: 'running' })
  })

  it('[TC-KA-24] 应用在后台时绝不投递（后台启动前台服务会被系统拒绝并记账）', () => {
    expect(decideStart({ ...base, foreground: false })).toEqual({ action: 'skip', reason: 'background' })
    // 后台优先级高于其它门：即使冷却也已过期，仍然不能投递
    expect(decideStart({ ...base, foreground: false, lastStopAt: 0, retryAfter: 0 })).toEqual({
      action: 'skip',
      reason: 'background',
    })
  })

  it('[TC-KA-25] 停服冷却期内必须等待，且等够剩余时长', () => {
    // lastStopAt=9900, now=10000 → 只过了 100ms，差 200ms
    expect(decideStart({ ...base, lastStopAt: 9900 })).toEqual({ action: 'wait', delayMs: 200 })
  })

  it('[TC-KA-26] 退避期内必须等待，且等够剩余时长', () => {
    expect(decideStart({ ...base, retryAfter: 12_500 })).toEqual({ action: 'wait', delayMs: 2500 })
  })

  it('[TC-KA-27] 冷却与退避同时生效时，取先到期的那个不能绕过冷却', () => {
    // 冷却剩 200ms，退避剩 2500ms → 先要满足冷却
    const d = decideStart({ ...base, lastStopAt: 9900, retryAfter: 12_500 })
    expect(d).toEqual({ action: 'wait', delayMs: 200 })
  })

  it('[TC-KA-28] 冷却门不可被反转：冷却刚过边界才放行', () => {
    // 恰好等于冷却时长 → 放行
    expect(decideStart({ ...base, now: 10_300, lastStopAt: 10_000 })).toEqual({ action: 'start' })
    // 差 1ms → 等待
    expect(decideStart({ ...base, now: 10_299, lastStopAt: 10_000 })).toEqual({
      action: 'wait',
      delayMs: 1,
    })
  })

  it('[TC-KA-29] 自定义冷却时长参与判定', () => {
    expect(decideStart({ ...base, lastStopAt: 9500, cooldownMs: 1000 })).toEqual({
      action: 'wait',
      delayMs: 500,
    })
    expect(decideStart({ ...base, lastStopAt: 9000, cooldownMs: 1000 })).toEqual({ action: 'start' })
  })
})
