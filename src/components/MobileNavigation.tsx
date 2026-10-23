import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react'
import { useWindowDimensions, View } from 'react-native'
import ReanimatedDrawerLayout, {
  DrawerKeyboardDismissMode,
  DrawerPosition,
  DrawerType,
  type DrawerLayoutMethods,
} from 'react-native-gesture-handler/ReanimatedDrawerLayout'

import { ChatDrawer } from '@/components/chat/ChatDrawer'
import { useTheme } from '@/theme'

const NavigationContext = createContext<(() => void) | null>(null)

export function useOpenNavigationDrawer() {
  return useContext(NavigationContext)
}

export function MobileNavigation({ children }: { children: ReactNode }) {
  const { c } = useTheme()
  const { width } = useWindowDimensions()
  const drawerRef = useRef<DrawerLayoutMethods>(null)
  const open = useCallback(() => drawerRef.current?.openDrawer({ animationSpeed: 0.6 }), [])
  const close = useCallback(() => drawerRef.current?.closeDrawer({ animationSpeed: 0.6 }), [])

  return (
    <NavigationContext.Provider value={open}>
      <ReanimatedDrawerLayout
        ref={drawerRef}
        drawerWidth={Math.min(width * 0.84, 340)}
        drawerPosition={DrawerPosition.LEFT}
        drawerType={DrawerType.FRONT}
        drawerBackgroundColor={c.surface}
        animationSpeed={0.6}
        edgeWidth={32}
        overlayColor={c.overlay}
        keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
        renderNavigationView={() => <ChatDrawer onClose={close} />}
      >
        <View style={{ flex: 1 }}>{children}</View>
      </ReanimatedDrawerLayout>
    </NavigationContext.Provider>
  )
}
