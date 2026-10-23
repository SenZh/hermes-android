import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { PanelLeft } from '@/components/icons'
import { IconButton, Text } from '@/components/ui'
import { useT } from '@/i18n'
import { space, useTheme } from '@/theme'
import { useOpenNavigationDrawer } from '@/components/MobileNavigation'

export function TabHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const { c } = useTheme()
  const t = useT()
  const openNavigationDrawer = useOpenNavigationDrawer()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={{
        paddingTop: insets.top + space.xs,
        paddingHorizontal: space.md,
        paddingBottom: space.xs,
        minHeight: 48,
        backgroundColor: c.bg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
      }}
    >
      <IconButton icon={PanelLeft} label={t('Open navigation')} onPress={() => openNavigationDrawer?.()} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="title" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}
