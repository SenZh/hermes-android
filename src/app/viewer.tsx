import { Stack, useLocalSearchParams } from 'expo-router'
import { File, Paths } from 'expo-file-system'
import { Image } from 'expo-image'
import * as Sharing from 'expo-sharing'
import { Platform, ScrollView, View } from 'react-native'

import { Markdown } from '@/components/chat/Markdown'
import { Download, Share2 } from '@/components/icons'
import { ErrorState, IconButton, Loading, Screen, Text, toast, toastError } from '@/components/ui'
import { useT } from '@/i18n'
import { bytes } from '@/lib/format'
import { hermes, rest } from '@/lib/hermes'
import { useRest } from '@/lib/hooks'
import { radius, space, useTheme } from '@/theme'

function decodeBase64Utf8(b64: string) {
  const bin = atob(b64)
  const bytesArr = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytesArr)
}

export default function DocumentViewerScreen() {
  const t = useT()
  const { c } = useTheme()
  const params = useLocalSearchParams<{ path?: string }>()
  const rawPath = params.path ? decodeURIComponent(params.path) : ''

  // 1. 标准化路径：
  let p = rawPath.replace(/^sandbox:\/?\/?/, '').replace(/^\.\//, '').trim()

  // 如果以 / 开头，且不是 /opt/data 开头，尝试剥离绝对前缀或判断是否为受管路径
  if (p.startsWith('/')) {
    if (p.startsWith('/opt/data/')) {
      // 已经是合法受管绝对路径，保留
    } else {
      // 类似 /output/xxx 或 /workspace/xxx，剥离多余的前缀根斜杠以当作相对路径
      p = p.replace(/^\//, '')
    }
  }

  // 映射 workspace 相对路径到后端受管目录 (后端默认 root 是 /opt/data，而项目在 /opt/data/workspace)
  let normalized = p
  if (normalized.startsWith('/opt/data/')) {
    // 绝对路径原生支持
  } else if (normalized.startsWith('workspace/')) {
    normalized = `/opt/data/${normalized}`
  } else {
    // 例如 output/test.md 或 src/app.tsx，位于工作区内
    normalized = `/opt/data/workspace/${normalized}`
  }

  // 严格沙箱校验：最终解析出的绝对路径必须在 /opt/data 之内
  const isSystemRestricted = !normalized.startsWith('/opt/data')

  const fileName = normalized ? normalized.split('/').pop() || normalized : ''

  const q = useRest<{ data_url: string; mime_type: string; size?: number }>(
    ['file-read', normalized],
    '/api/files/read',
    { path: normalized },
    { enabled: !!normalized && !isSystemRestricted },
  )

  const mime = q.data?.mime_type ?? ''
  const b64 = q.data?.data_url ? q.data.data_url.slice(q.data.data_url.indexOf(',') + 1) : ''
  const isText =
    /^text\/|json|yaml|xml|javascript|typescript|x-sh|toml/.test(mime) ||
    /\.(md|txt|py|ts|tsx|js|json|ya?ml|toml|sh|log|ini|cfg|env|rs|go|java|kt|c|h|cpp|css|html|sql|xml|patch|diff)$/i.test(fileName)

  let text = ''
  if (isText && b64) {
    try {
      text = decodeBase64Utf8(b64)
    } catch {
      text = ''
    }
  }

  // 快捷分享
  async function share() {
    if (!normalized || isSystemRestricted) return
    try {
      if (Platform.OS === 'web') return toast(t('Sharing is available in the Android app.'), 'info')
      const dest = new File(Paths.cache, fileName)
      if (dest.exists) dest.delete()
      const url = hermes().rest.url('/api/files/download', { path: normalized })
      const file = await File.downloadFileAsync(url, dest, { headers: await hermes().authHeaders() })
      await Sharing.shareAsync(file.uri, { mimeType: mime || undefined })
    } catch (e) {
      toastError(e)
    }
  }

  // 下载保存到手机 Cache/临时区并通知
  async function download() {
    if (!normalized || isSystemRestricted) return
    try {
      if (Platform.OS === 'web') return toast(t('Downloading is available in the Android app.'), 'info')
      const dest = new File(Paths.cache, fileName)
      if (dest.exists) dest.delete()
      const url = hermes().rest.url('/api/files/download', { path: normalized })
      await File.downloadFileAsync(url, dest, { headers: await hermes().authHeaders() })
      toast(t('File ready: {name}', { name: fileName }), 'success')
      await Sharing.shareAsync(dest.uri, { mimeType: mime || undefined })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: fileName || t('Document'),
          headerRight: () =>
            !isSystemRestricted ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <IconButton icon={Download} label={t('Download')} onPress={download} />
                <IconButton icon={Share2} label={t('Share')} onPress={share} />
              </View>
            ) : null,
        }}
      />
      <View style={{ paddingBottom: space.xs }}>
        <Text variant="caption" tone="faint" mono selectable>
          {normalized} {q.data?.size ? `· ${bytes(q.data.size)}` : ''}
        </Text>
      </View>

      {isSystemRestricted ? (
        <View
          style={{ padding: space.md, borderRadius: radius.md, backgroundColor: c.surfaceAlt, gap: space.xs, marginVertical: space.md }}
        >
          <Text weight="semibold" tone="warn">
            {t('System path outside managed workspace')}
          </Text>
          <Text variant="small" tone="muted">
            {t(
              'This path is outside the safe file root (/opt/data). For security reasons, the server only allows viewing and downloading files within the workspace.',
            )}
          </Text>
        </View>
      ) : null}

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}

      {mime.startsWith('image/') && q.data ? (
        <Image source={{ uri: q.data.data_url }} style={{ width: '100%', aspectRatio: 1, borderRadius: radius.md }} contentFit="contain" />
      ) : null}

      {isText && text ? (
        /\.md$/i.test(fileName) ? (
          <ScrollView showsVerticalScrollIndicator contentContainerStyle={{ paddingBottom: space.xxl }}>
            <Markdown text={text.slice(0, 100_000)} />
          </ScrollView>
        ) : (
          <ScrollView horizontal style={{ backgroundColor: c.codeBg, borderRadius: radius.md, flex: 1 }}>
            <ScrollView showsVerticalScrollIndicator contentContainerStyle={{ padding: space.md, paddingBottom: space.xxl }}>
              <Text mono variant="caption" selectable>
                {text.slice(0, 100_000)}
              </Text>
            </ScrollView>
          </ScrollView>
        )
      ) : null}

      {q.data && !isText && !mime.startsWith('image/') ? (
        <View style={{ padding: space.lg, alignItems: 'center' }}>
          <Text tone="muted">{t('No preview for {mime}.', { mime: mime || t('this file type') })}</Text>
        </View>
      ) : null}
    </Screen>
  )
}
