/**
 * 图片查看器的缩放策略（纯函数，不碰 UI，便于单测）。
 *
 * 这些函数带 `'worklet'` 指令，会在 UI 线程执行。**worklet 内不得引用任何模块级标识符**，
 * 包括参数默认值里的常量：babel 的 worklet 插件只捕获函数体里直接引用的自由变量，
 * 默认参数中的引用不会被捕获，真机表现是
 * `Property 'RUBBER_BAND_FLOOR' doesn't exist` 并直接 crash。
 *
 * 所以每个 worklet 函数体都用字面量；下面的导出常量只给普通 JS 侧和测试用，
 * 一致性由 TC-ZOOM-12 与 verify-fixes 的 Test 30 锁定。
 */

/** 原始大小：图片铺满容器但保持完整比例。 */
export const MIN_SCALE = 1
/** 上限。再放大就只剩马赛克了。 */
export const MAX_SCALE = 5
/** 判定「是否已放大」的浮点容差。捏合产生的值几乎不会正好等于 1。 */
export const SCALE_EPSILON = 0.001
/** 双击直接跳到这个倍率，比逐级放大顺手。 */
export const DOUBLE_TAP_SCALE = 2.5
/** 捏合过程中允许短暂缩到 1x 以下，松手时再回弹——否则手指稍微一松就卡住不动。 */
export const RUBBER_BAND_FLOOR = 0.7

/**
 * 把捏合产生的倍率夹到合法区间。
 *
 * 过程中允许下探到 1x 以下，松手由 `shouldSnapBack` + 调用方回弹。
 * 这里只负责夹取，不负责回弹。
 */
export function clampScale(next: number, floor?: number): number {
  'worklet'
  // 0.7 / 1 / 5 必须与 RUBBER_BAND_FLOOR / MIN_SCALE / MAX_SCALE 一致（TC-ZOOM-12 锁定）
  const lo = floor === undefined ? 0.7 : floor
  if (Number.isNaN(next)) return 1
  if (next < lo) return lo
  if (next > 5) return 5
  return next
}

/** 松手后是否该回弹到原始大小。 */
export function shouldSnapBack(scale: number): boolean {
  'worklet'
  return scale < 1
}

/**
 * 单击该干什么。
 *
 * 放大状态下单击是「复位」，不是「退出全屏」——用户放大后想回到全貌，
 * 第一反应是点一下，此时直接退出全屏会很突兀。
 */
export function resolveSingleTap(scale: number): 'reset' | 'fullscreen' {
  'worklet'
  const epsilon = 0.001
  return scale > 1 + epsilon ? 'reset' : 'fullscreen'
}

/** 双击在 1x 与 2.5x 之间来回切。 */
export function nextDoubleTapScale(scale: number): number {
  'worklet'
  const epsilon = 0.001
  return scale > 1 + epsilon ? 1 : 2.5
}

/**
 * 放大后平移的边界，防止把图片拖出屏幕外只剩黑底。
 * 容器宽高与当前倍率已知时，可移动范围是 (内容尺寸 - 容器尺寸) / 2，且不小于 0。
 */
export function clampTranslation(
  value: number,
  containerSize: number,
  contentSize: number,
  scale: number,
): number {
  'worklet'
  if (!Number.isFinite(value) || containerSize <= 0) return 0
  const overflow = (contentSize * scale - containerSize) / 2
  if (overflow <= 0) return 0
  if (value > overflow) return overflow
  if (value < -overflow) return -overflow
  return value
}
