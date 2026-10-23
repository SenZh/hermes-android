import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
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
  const [opened, setOpened] = useState(false)
  const open = useCallback(() => drawerRef.current?.openDrawer(), [])
  const close = useCallback(() => drawerRef.current?.closeDrawer(), [])

  return (
    <NavigationContext.Provider value={open}>
      <ReanimatedDrawerLayout
        ref={drawerRef}
        drawerWidth={Math.min(width * 0.84, 340)}
        drawerPosition={DrawerPosition.LEFT}
        drawerType={DrawerType.FRONT}
        edgeWidth={24}
        overlayColor={c.overlay}
        keyboardDismissMode={DrawerKeyboardDismissMode.ON_DRAG}
        onDrawerOpen={() => setOpened(true)}
        onDrawerClose={() => setOpened(false)}
        renderNavigationView={() => (opened ? <ChatDrawer onClose={close} /> : null)}
      >
        <View style={{ flex: 1 }}>{children}</View>
      </ReanimatedDrawerLayout>
    </NavigationContext.Provider>
  )
}
