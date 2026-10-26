import { Image } from 'expo-image'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { clampScale, clampTranslation, MIN_SCALE, nextDoubleTapScale, resolveSingleTap, shouldSnapBack } from '@/lib/imageZoom'

type Props = {
  uri: string
  /** 原始大小下单击时触发（用于切换全屏）。放大状态下单击是复位，不触发。 */
  onSingleTap?: () => void
  /** 全屏层用黑色背景，页面内嵌用透明。 */
  background?: string
}

/**
 * 支持双指捏合缩放、放大后拖动、双击切换倍率、单击切换全屏的图片查看器。
 *
 * 手势回调跑在 UI 线程，只允许读写 shared value；任何分支判断都走 `@/lib/imageZoom`
 * 的纯函数，保证可被单测覆盖。
 */
export function ZoomableImage({ uri, onSingleTap, background = 'transparent' }: Props) {
  const scale = useSharedValue(MIN_SCALE)
  const originScale = useSharedValue(MIN_SCALE)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const originTx = useSharedValue(0)
  const originTy = useSharedValue(0)
  const boxW = useSharedValue(0)
  const boxH = useSharedValue(0)

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
      }
    })

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value <= MIN_SCALE) return
      tx.value = clampTranslation(originTx.value + e.translationX, boxW.value, boxW.value, scale.value)
      ty.value = clampTranslation(originTy.value + e.translationY, boxH.value, boxH.value, scale.value)
    })
    .onEnd(() => {
      originTx.value = tx.value
      originTy.value = ty.value
    })

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
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
    .onEnd(() => {
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
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={120} />
      </Animated.View>
    </GestureDetector>
  )
}

export function ZoomableImageFrame({ uri, onSingleTap }: Props) {
  return (
    <View style={{ flex: 1, borderRadius: 12, overflow: 'hidden' }}>
      <ZoomableImage uri={uri} onSingleTap={onSingleTap} />
    </View>
  )
}
