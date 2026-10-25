import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { SessionRow } from '@/app/(tabs)/sessions'
import { ChevronDown, PanelLeft, Search } from '@/components/icons'
import { Sheet, Text } from '@/components/ui'
import { useT } from '@/i18n'
import { relativeTime } from '@/lib/format'
import { rest, useRuntime } from '@/lib/hermes'
import { newChat, openStored, useChat } from '@/store/chat'
import { useOpenNavigationDrawer } from '@/components/MobileNavigation'
import { font, radius, space, useTheme } from '@/theme'

export function SessionChooserSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT()
  const { c } = useTheme()
  const openNavigationDrawer = useOpenNavigationDrawer()
  const insets = useSafeAreaInsets()
  const connected = useRuntime((s) => s.state === 'open')
  const [query, setQuery] = useState('')
  const activeId = useChat((s) => s.activeId)
  const activeStored = useChat((s) => (s.activeId ? s.sessions[s.activeId]?.storedId : null))
  const recent = useQuery({
    queryKey: ['sessions', 'title-chooser'],
    enabled: visible && connected,
    staleTime: 15_000,
    queryFn: () =>
      rest().get<{ sessions: SessionRow[] }>('/api/sessions', {
        query: { limit: 60, offset: 0, order: 'recent', archived: 'exclude', min_messages: 1, exclude_sources: 'cron' },
      }),
  })
  const rows = useMemo(() => {
    const all = recent.data?.sessions ?? []
    const needle = query.trim().toLowerCase()
    const filtered = needle ? all.filter((r) => `${r.title ?? ''} ${r.preview ?? ''}`.toLowerCase().includes(needle)) : all
    return [...filtered.filter((r) => r.pinned), ...filtered.filter((r) => !r.pinned)]
  }, [recent.data, query])

  return (
    <Sheet visible={visible} onClose={onClose} title={t('Select conversation')} heightRatio={0.72}>
      <View style={{ gap: space.sm, paddingBottom: space.sm }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onClose()
            openNavigationDrawer?.()
          }}
          style={({ pressed }) => [styles.navButton, { backgroundColor: pressed ? c.surfaceAlt : 'transparent' }]}
        >
          <PanelLeft size={18} color={c.textMuted} />
          <Text variant="small" tone="muted">
            {t('Navigation')}
          </Text>
        </Pressable>
        <View style={[styles.search, { backgroundColor: c.bg, borderColor: c.border }]}>
          <Search size={16} color={c.textFaint} strokeWidth={1.75} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('Search sessions')}
            placeholderTextColor={c.textFaint}
            accessibilityLabel={t('Search sessions')}
            returnKeyType="search"
            style={{ flex: 1, minWidth: 0, color: c.text, fontFamily: font.regular, fontSize: 15, height: 42 }}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onClose()
            if (activeId) void newChat()
          }}
          style={({ pressed }) => [styles.newChat, { backgroundColor: pressed ? c.surfaceAlt : c.elevated, borderColor: c.border }]}
        >
          <Text weight="medium">{t('New chat')}</Text>
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + space.md }}
        renderItem={({ item }) => {
          const connectedAt = item.last_active ?? item.started_at ?? 0
          const current = item.id === activeStored
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: current }}
              onPress={() => {
                onClose()
                openStored(item.id).catch(() => {})
              }}
              style={({ pressed }) => [styles.row, { backgroundColor: current ? c.accentSoft : pressed ? c.surfaceAlt : 'transparent' }]}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text weight={current ? 'semibold' : 'medium'} numberOfLines={1}>
                  {item.title || t('Untitled session')}
                </Text>
                {item.preview ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {item.preview}
                  </Text>
                ) : null}
                <Text variant="caption" tone="faint" numberOfLines={1}>
                  {connectedAt ? relativeTime(connectedAt) : ''}
                </Text>
              </View>
              {current ? <ChevronDown size={17} color={c.accentText} /> : null}
            </Pressable>
          )
        }}
        ListEmptyComponent={
          recent.isLoading ? null : (
            <Text tone="muted" variant="small" style={{ padding: space.lg }}>
              {query ? t('No matches') : t('No conversations yet')}
            </Text>
          )
        }
        onRefresh={() => {
          void recent.refetch()
        }}
        refreshing={recent.isRefetching}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  navButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  newChat: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    minHeight: 62,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
})
