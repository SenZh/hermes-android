import { ArrowUpCircle, Check, Info, RefreshCw, X } from '@/components/icons'
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import Constants from 'expo-constants'

import { Button, Text, toast, toastError } from '@/components/ui'
import { useT } from '@/i18n'
import { useUpdater } from '@/services/updater'
import { radius, space, useTheme } from '@/theme'

export function VersionModal({
  visible,
  onClose,
  gatewayVersion,
}: {
  visible: boolean
  onClose: () => void
  gatewayVersion?: string
}) {
  const t = useT()
  const { c } = useTheme()
  const updateInfo = useUpdater((s) => s.info)
  const checking = useUpdater((s) => s.checking)
  const check = useUpdater((s) => s.check)

  const appVersion = `v${Constants.expoConfig?.version ?? '1.8.3'}`

  async function handleCheck() {
    try {
      toast(t('Checking for updates…'), 'info')
      const res = await check(false)
      if (res?.hasUpdate && res.downloadUrl) {
        toast(t('New version available: {ver}', { ver: res.latestVersion }), 'success')
      } else {
        toast(t('Already up to date'), 'success')
      }
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={onClose}>
        <Pressable
          style={[styles.card, { backgroundColor: c.elevated, borderColor: c.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              {updateInfo?.hasUpdate ? (
                <ArrowUpCircle size={20} color={c.accent} />
              ) : (
                <Info size={20} color={c.text} />
              )}
              <Text weight="semibold" variant="title">
                {t('Version & Updates')}
              </Text>
            </View>
            <Pressable hitSlop={10} onPress={onClose}>
              <X size={18} color={c.textMuted} />
            </Pressable>
          </View>

          <View style={styles.content}>
            <View style={styles.row}>
              <Text tone="muted">{t('App Version')}</Text>
              <Text weight="medium">{appVersion}</Text>
            </View>

            {gatewayVersion ? (
              <View style={styles.row}>
                <Text tone="muted">{t('Gateway')}</Text>
                <Text weight="medium">{gatewayVersion}</Text>
              </View>
            ) : null}

            <View style={[styles.statusBox, { backgroundColor: c.surfaceAlt }]}>
              {updateInfo?.hasUpdate ? (
                <View style={{ gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ArrowUpCircle size={16} color={c.accent} />
                    <Text tone="accent" weight="semibold">
                      {t('New version available: {ver}', { ver: updateInfo.latestVersion })}
                    </Text>
                  </View>
                  <Text variant="caption" tone="muted">
                    {t('A newer release is available for download.')}
                  </Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Check size={16} color={c.accentText} />
                  <Text tone="muted">{t('Already up to date')}</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.actions}>
            <Button
              label={t('Check for updates')}
              variant="secondary"
              icon={RefreshCw}
              disabled={checking}
              onPress={handleCheck}
            />
            {updateInfo?.hasUpdate && updateInfo.downloadUrl ? (
              <Button
                label={t('Download update')}
                variant="primary"
                icon={ArrowUpCircle}
                onPress={() => {
                  onClose()
                  const Linking = require('react-native').Linking
                  void Linking.openURL(updateInfo.downloadUrl)
                }}
              />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: space.lg,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  content: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBox: {
    padding: space.md,
    borderRadius: radius.md,
    marginTop: space.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
    marginTop: space.xs,
  },
})
