import { Tabs } from 'expo-router'
import { useT } from '@/i18n'
import { haptic } from '@/lib/haptics'
import { MobileNavigation } from '@/components/MobileNavigation'

export default function TabsLayout() {
  const t = useT()
  return (
    <MobileNavigation>
      <Tabs screenListeners={{ tabPress: () => haptic('select') }} screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
        <Tabs.Screen name="chat" options={{ title: t('Chat') }} />
        <Tabs.Screen name="sessions" options={{ title: t('Sessions') }} />
        <Tabs.Screen name="agent" options={{ title: t('Agent') }} />
        <Tabs.Screen name="automate" options={{ title: t('Automate') }} />
        <Tabs.Screen name="more" options={{ title: t('More') }} />
      </Tabs>
    </MobileNavigation>
  )
}

export { RouteError as ErrorBoundary } from '@/components/RouteError'
