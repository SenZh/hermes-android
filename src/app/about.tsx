import Constants from 'expo-constants'
import * as Clipboard from 'expo-clipboard'
import { Stack, useFocusEffect } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { BookOpen, Bug, BatteryCharging, Code2, MessageCircle, Rocket } from '@/components/icons'
import { useCallback, useState } from 'react'
import { Platform, View } from 'react-native'

import { HermesMark } from '@/components/HermesMark'
import { KeyValue, Row, Screen, Section, Text, toast } from '@/components/ui'
import { useT } from '@/i18n'
import { acknowledgeExit, copyExitReport, lastExit } from '@/lib/crashReport'
import { relativeTime } from '@/lib/format'
import { useRest } from '@/lib/hooks'
import { useRuntime } from '@/lib/hermes'
import { space } from '@/theme'

import type { LastExit } from '../../modules/hermes-keepalive'
import { KeepAlive } from '../../modules/hermes-keepalive'

export default function AboutScreen() {
  const t = useT()
  const health = useRest<{ version?: string; displayVersion?: string }>(['health'], '/api/health')
  const conn = useRuntime((s) => s.hermes?.conn)
  const [crash, setCrash] = useState<LastExit | null>(() => lastExit())
  // 用户点进系统设置改完电池策略再返回，页面必须重读；只在 render 期读一次会一直显示旧状态。
  const [batteryExempt, setBatteryExempt] = useState(() => KeepAlive.batteryOptimizationIgnored())
  useFocusEffect(
    useCallback(() => {
      setBatteryExempt(KeepAlive.batteryOptimizationIgnored())
    }, []),
  )
  return (
    <Screen>
      <Stack.Screen options={{ title: t('About') }} />
      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xl }}>
        <HermesMark size={80} />
        <Text variant="h1">Hermes</Text>
        <Text tone="muted" center>
          {t('An Android client for Hermes Agent by Nous Research.')}
        </Text>
      </View>
      <Section title={t('Versions')}>
        <View style={{ padding: space.lg }}>
          <KeyValue label={t('App')} value={Constants.expoConfig?.version ?? '?'} />
          <KeyValue label={t('Hermes backend')} value={health.data?.displayVersion ?? health.data?.version ?? '—'} />
          <KeyValue label={t('Backend address')} value={conn?.baseUrl ?? '—'} mono />
          <KeyValue label={t('Gateway protocol')} value="tui_gateway JSON-RPC v1" />
        </View>
      </Section>
      {crash ? (
        <Section title={t('Diagnostics')}>
          <Row
            icon={Bug}
            title={t('Last crash report')}
            subtitle={`${crash.description} · ${relativeTime(crash.timestamp)}`}
            onPress={async () => {
              await copyExitReport(crash)
              acknowledgeExit()
              setCrash(null)
              toast(t('Copied'), 'success')
            }}
            last
          />
        </Section>
      ) : null}
      {KeepAlive.lastStartError() ? (
        <Section title={t('Diagnostics')}>
          <Row
            icon={Bug}
            title={t('Background service')}
            subtitle={KeepAlive.lastStartError() ?? ''}
            onPress={() => {
              void Clipboard.setStringAsync(KeepAlive.lastStartError() ?? '')
              toast(t('Copied'), 'success')
            }}
            last
          />
        </Section>
      ) : null}
      {Platform.OS === 'android' && KeepAlive.available ? (
        <Section title={t('Background keep-alive')}>
          <Row
            icon={BatteryCharging}
            title={t('Battery optimization')}
            subtitle={batteryExempt ? t('Exempt') : t('Restricted — tap to allow background work')}
            onPress={() => {
              if (!KeepAlive.requestBatteryExemption()) {
                toast(t('Could not open battery settings'), 'info')
              }
            }}
          />
          <Row
            icon={Rocket}
            title={t('Auto-start')}
            subtitle={t('Open the system screen and allow Hermes')}
            onPress={() => {
              const result = KeepAlive.openAutoStartSettings()
              if (result === 'appdetails') {
                toast(t('No known auto-start screen on this ROM — opening app settings.'), 'info')
              } else if (result === '') {
                toast(t('Could not open auto-start settings'), 'info')
              }
            }}
            last
          />
        </Section>
      ) : null}
      <Section title={t('Links')}>
        <Row
          icon={Code2}
          title={t('App source code')}
          subtitle="github.com/SenZh/hermes-android"
          onPress={() => WebBrowser.openBrowserAsync('https://github.com/SenZh/hermes-android')}
        />
        <Row
          icon={Code2}
          title="Hermes Agent"
          subtitle="github.com/NousResearch/hermes-agent"
          onPress={() => WebBrowser.openBrowserAsync('https://github.com/NousResearch/hermes-agent')}
        />
        <Row
          icon={BookOpen}
          title={t('Documentation')}
          onPress={() => WebBrowser.openBrowserAsync('https://hermes-agent.nousresearch.com/docs/')}
        />
        <Row
          icon={MessageCircle}
          title={t('Nous Research Discord')}
          onPress={() => WebBrowser.openBrowserAsync('https://discord.gg/NousResearch')}
          last
        />
      </Section>
      <Text variant="caption" tone="faint" center>
        {t('Not affiliated with Nous Research. MIT licensed.')}
      </Text>
    </Screen>
  )
}
