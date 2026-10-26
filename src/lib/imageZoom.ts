/**
 * 图片查看器的缩放策略（纯函数，不碰 UI，便于单测）。
 *
 * 手势回调跑在 UI 线程，必须保持极简；所有可判定的数学与状态决策都放这里，
 * 组件只做共享值的读写。
 */

/** 原始大小：图片铺满容器但保持完整比例。 */
export const MIN_SCALE = 1
/** 上限。再放大就只剩马赛克了。 */
export const MAX_SCALE = 5
/** 双击直接跳到这个倍率，比逐级放大顺手。 */
export const DOUBLE_TAP_SCALE = 2.5
/** 捏合过程中允许短暂缩到 1x 以下，松手时再回弹——否则手指稍微一松就卡住不动。 */
export const RUBBER_BAND_FLOOR = 0.7

/**
 * 把捏合产生的倍率夹到合法区间。
 * 手指离开时用 MIN_SCALE 兜底（不允许停在 1x 以下），过程中用 RUBBER_BAND_FLOOR。
 */
export function clampScale(next: number, floor: number = RUBBER_BAND_FLOOR): number {
  // 只有 NaN 无意义；±Infinity 按上下限处理，否则极限捏合会被误判成归零。
  if (Number.isNaN(next)) return MIN_SCALE
  if (next < floor) return floor
  if (next > MAX_SCALE) return MAX_SCALE
  return next
}

/** 松手后是否该回弹到原始大小。 */
export function shouldSnapBack(scale: number): boolean {
  return scale < MIN_SCALE
}

/**
 * 单击该干什么。
 *
 * 放大状态下单击是「复位」，不是「退出全屏」——用户放大后想回到全貌，
 * 第一反应是点一下，此时直接退出全屏会很突兀。
 */
export function resolveSingleTap(scale: number): 'reset' | 'fullscreen' {
  return scale > MIN_SCALE + 0.001 ? 'reset' : 'fullscreen'
}

/** 双击在 1x 与 DOUBLE_TAP_SCALE 之间来回切。 */
export function nextDoubleTapScale(scale: number): number {
  return scale > MIN_SCALE + 0.001 ? MIN_SCALE : DOUBLE_TAP_SCALE
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
  if (!Number.isFinite(value) || containerSize <= 0) return 0
  const overflow = (contentSize * scale - containerSize) / 2
  if (overflow <= 0) return 0
  if (value > overflow) return overflow
  if (value < -overflow) return -overflow
  return value
}
