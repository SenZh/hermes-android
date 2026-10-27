import { Image } from 'expo-image'
import { StyleSheet } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { clampScale, clampTranslation, MIN_SCALE, nextDoubleTapScale, resolveSingleTap, shouldSnapBack } from '@/lib/imageZoom'

type Props = {
  uri: string
  /** 原始大小下单击时触发（用于切换全屏）。放大状态下单击是复位，不触发。 */
  onSingleTap?: () => void
  /** 全屏层用黑色背景，页面内嵌用透明。 */
  background?: string
  /**
   * 是否允许单指拖动。
   *
   * 内嵌预览必须关掉：它挂在页面的 ScrollView 里，Pan 会和纵向滚动抢手势，
   * 用户想滚页面结果在拖图片。缩放与单击仍可用，进全屏后再拖。
   */
  enablePan?: boolean
}

/**
 * 支持双指捏合缩放、放大后拖动、双击切换倍率、单击切换全屏的图片查看器。
 *
 * 手势回调跑在 UI 线程，只允许读写 shared value；任何分支判断都走 `@/lib/imageZoom`
 * 的纯函数，保证可被单测覆盖。
 */
export function ZoomableImage({ uri, onSingleTap, background = 'transparent', enablePan = true }: Props) {
  const scale = useSharedValue(MIN_SCALE)
  const originScale = useSharedValue(MIN_SCALE)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const originTx = useSharedValue(0)
  const originTy = useSharedValue(0)
  const boxW = useSharedValue(0)
  const boxH = useSharedValue(0)
  /** 图片在 contain 模式下实际占据的尺寸，用于平移边界。用容器尺寸替代会把图片拖出屏幕。 */
  const contentW = useSharedValue(0)
  const contentH = useSharedValue(0)

  const toOrigin = () => {
    'worklet'
    scale.value = withTiming(MIN_SCALE)
    tx.value = withTiming(0)
    ty.value = withTiming(0)
    originScale.value = MIN_SCALE
    originTx.value = 0
    originTy.value = 0
  }

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clampScale(originScale.value * e.scale)
    })
    .onEnd(() => {
      if (shouldSnapBack(scale.value)) {
        toOrigin()
      } else {
        originScale.value = scale.value
        // 缩小时可移动范围同步变小：5x 拖到边角再缩回 1.5x，旧偏移必须重新夹取，
        // 否则图片会停在屏幕外。
        const cw = contentW.value > 0 ? contentW.value : boxW.value
        const ch = contentH.value > 0 ? contentH.value : boxH.value
        tx.value = clampTranslation(tx.value, boxW.value, cw, scale.value)
        ty.value = clampTranslation(ty.value, boxH.value, ch, scale.value)
        originTx.value = tx.value
        originTy.value = ty.value
      }
    })

  const pan = Gesture.Pan()
    .enabled(enablePan)
    .onUpdate((e) => {
      if (scale.value <= MIN_SCALE) return
      // 内容尺寸取图片 contain 后的真实显示尺寸；拿容器尺寸会让边界大出一截，
      // 取满时整幅图移出视野只剩黑底。
      const cw = contentW.value > 0 ? contentW.value : boxW.value
      const ch = contentH.value > 0 ? contentH.value : boxH.value
      tx.value = clampTranslation(originTx.value + e.translationX, boxW.value, cw, scale.value)
      ty.value = clampTranslation(originTy.value + e.translationY, boxH.value, ch, scale.value)
    })
    .onEnd(() => {
      originTx.value = tx.value
      originTy.value = ty.value
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((_e, success) => {
      // handler 由 ACTIVE 转 FAILED/CANCELLED 时回调也会跑。不判 success 的话，
      // 一次最终被识别成单击的点击会顺手把倍率也切了。
      if (!success) return
      const next = nextDoubleTapScale(scale.value)
      if (next <= MIN_SCALE) {
        toOrigin()
      } else {
        scale.value = withTiming(next)
        originScale.value = next
      }
    })

  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((_e, success) => {
      if (!success) return
      if (resolveSingleTap(scale.value) === 'reset') {
        toOrigin()
      } else if (onSingleTap) {
        runOnJS(onSingleTap)()
      }
    })

  const gesture = Gesture.Simultaneous(
    Gesture.Exclusive(doubleTap, singleTap),
    Gesture.Simultaneous(pinch, pan),
  )

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: background }, animatedStyle]}
        onLayout={(e) => {
          boxW.value = e.nativeEvent.layout.width
          boxH.value = e.nativeEvent.layout.height
        }}
      >
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={120}
          onLoad={(e) => {
            // contain：按较小比例缩放，图片完整可见。算出真实占位后平移边界才准。
            const { width, height } = e.source
            if (!width || !height || boxW.value <= 0 || boxH.value <= 0) return
            const fit = Math.min(boxW.value / width, boxH.value / height)
            contentW.value = width * fit
            contentH.value = height * fit
          }}
        />
      </Animated.View>
    </GestureDetector>
  )
}
