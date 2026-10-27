import { describe, expect, it } from 'vitest'

import {
  clampScale,
  clampTranslation,
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  nextDoubleTapScale,
  resolveSingleTap,
  RUBBER_BAND_FLOOR,
  SCALE_EPSILON,
  shouldSnapBack,
} from '@/lib/imageZoom'

describe('ImageZoom: clampScale', () => {
  it('[TC-ZOOM-01] 捏合放大时夹在上限内', () => {
    expect(clampScale(2.4)).toBe(2.4)
    expect(clampScale(99)).toBe(MAX_SCALE)
  })

  it('[TC-ZOOM-02] 手指捏合过程中允许缩到软下限，松手才回弹', () => {
    expect(clampScale(0.8)).toBe(0.8)
    expect(clampScale(0.1)).toBe(RUBBER_BAND_FLOOR)
  })

  it('[TC-ZOOM-03] 非法数值不污染共享值', () => {
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MAX_SCALE)
    expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(RUBBER_BAND_FLOOR)
  })

  it('[TC-ZOOM-04] 松手后仅当低于原始大小才回弹', () => {
    expect(shouldSnapBack(0.85)).toBe(true)
    expect(shouldSnapBack(1)).toBe(false)
    expect(shouldSnapBack(1.0001)).toBe(false)
  })
})

describe('ImageZoom: 单击语义', () => {
  it('[TC-ZOOM-05] 原始大小单击 → 进入全屏', () => {
    expect(resolveSingleTap(MIN_SCALE)).toBe('fullscreen')
  })

  it('[TC-ZOOM-06] 放大后单击 → 先复位，不退出全屏', () => {
    expect(resolveSingleTap(1.5)).toBe('reset')
    expect(resolveSingleTap(MAX_SCALE)).toBe('reset')
  })

  it('[TC-ZOOM-07] 浮点误差不能让「1x」被误判成放大', () => {
    expect(resolveSingleTap(1.0000001)).toBe('fullscreen')
  })
})

describe('ImageZoom: 双击', () => {
  it('[TC-ZOOM-08] 双击在 1x 与 2.5x 之间往返', () => {
    expect(nextDoubleTapScale(MIN_SCALE)).toBe(DOUBLE_TAP_SCALE)
    expect(nextDoubleTapScale(DOUBLE_TAP_SCALE)).toBe(MIN_SCALE)
    expect(nextDoubleTapScale(4)).toBe(MIN_SCALE)
  })
})

describe('ImageZoom: 常量与 worklet 字面量的一致性', () => {
  // worklet 函数体里只能写字面量（引用模块常量在 UI 线程会 crash），
  // 所以必须用运行时行为反查字面量与导出常量是否还一致。
  it('[TC-ZOOM-12] 字面量与导出常量保持同值', () => {
    expect(clampScale(0.1)).toBe(RUBBER_BAND_FLOOR)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE)
    expect(clampScale(2, MIN_SCALE)).toBe(2)

    expect(shouldSnapBack(MIN_SCALE - 0.01)).toBe(true)
    expect(shouldSnapBack(MIN_SCALE)).toBe(false)

    expect(nextDoubleTapScale(MIN_SCALE)).toBe(DOUBLE_TAP_SCALE)
    expect(nextDoubleTapScale(DOUBLE_TAP_SCALE)).toBe(MIN_SCALE)

    expect(resolveSingleTap(MIN_SCALE)).toBe('fullscreen')
    expect(resolveSingleTap(MIN_SCALE + SCALE_EPSILON * 2)).toBe('reset')
  })
})

describe('ImageZoom: 平移边界', () => {
  it('[TC-ZOOM-09] 未放大时不允许平移', () => {
    expect(clampTranslation(120, 400, 400, 1)).toBe(0)
  })

  it('[TC-ZOOM-10] 放大后按溢出量夹取，不能把图片拖出屏幕', () => {
    // 容器 400，内容 800，2x → 溢出 (1600-400)/2 = 600
    expect(clampTranslation(200, 400, 800, 2)).toBe(200)
    expect(clampTranslation(9999, 400, 800, 2)).toBe(600)
    expect(clampTranslation(-9999, 400, 800, 2)).toBe(-600)
  })

  it('[TC-ZOOM-11] 内容小于容器时同样锁死在原点', () => {
    expect(clampTranslation(50, 400, 200, 1)).toBe(0)
  })
})
