import { Image } from 'expo-image'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Platform, ScrollView, View } from 'react-native'

import { Markdown } from '@/components/chat/Markdown'
import { Share2 } from '@/components/icons'
import { Button, ErrorState, IconButton, Loading, Sheet, Text, toast, toastError } from '@/components/ui'
import { useT } from '@/i18n'
import { bytes } from '@/lib/format'
import { hermes, rest } from '@/lib/hermes'
import { useRest } from '@/lib/hooks'
import { openFileViewer, useChat } from '@/store/chat'
import { radius, space, useTheme } from '@/theme'

function decodeBase64Utf8(b64: string) {
  const bin = atob(b64)
  const bytesArr = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytesArr)
}

export function FileViewerSheet() {
  const t = useT()
  const { c } = useTheme()
  const filePath = useChat((s) => s.viewingFilePath)
  const onClose = () => openFileViewer(null)

  const fileName = filePath ? filePath.split('/').pop() || filePath : ''
  const q = useRest<{ data_url: string; mime_type: string; size?: number }>(
    ['file-read', filePath],
    '/api/files/read',
    { path: filePath ?? '' },
    { enabled: !!filePath },
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

  async function share() {
    if (!filePath) return
    try {
      if (Platform.OS === 'web') return toast(t('Sharing is available in the Android app.'), 'info')
      const dest = new File(Paths.cache, fileName)
      if (dest.exists) dest.delete()
      const url = hermes().rest.url('/api/files/download', { path: filePath })
      const file = await File.downloadFileAsync(url, dest, { headers: await hermes().authHeaders() })
      await Sharing.shareAsync(file.uri, { mimeType: mime || undefined })
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Sheet
      visible={!!filePath}
      onClose={onClose}
      title={fileName}
      heightRatio={0.92}
      footer={
        <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'center' }}>
          <Button
            label={t('Ask Hermes about it')}
            onPress={() => {
              if (filePath) {
                const rid = useChat.getState().activeId ?? ''
                onClose()
                useChat.getState().composerPrefill = { runtimeId: rid, text: `@file:${filePath} ` }
              }
            }}
            style={{ flex: 1 }}
          />
          <IconButton icon={Share2} label={t('Download / share')} onPress={share} />
        </View>
      }
    >
      <Text variant="caption" tone="faint" mono selectable style={{ marginBottom: space.xs }}>
        {filePath} {q.data?.size ? `· ${bytes(q.data.size)}` : ''}
      </Text>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorState error={q.error} /> : null}
      {mime.startsWith('image/') && q.data ? (
        <Image source={{ uri: q.data.data_url }} style={{ width: '100%', aspectRatio: 1, borderRadius: radius.md }} contentFit="contain" />
      ) : null}
      {isText && text ? (
        /\.md$/i.test(fileName) ? (
          <Markdown text={text.slice(0, 60_000)} />
        ) : (
          <ScrollView horizontal style={{ backgroundColor: c.codeBg, borderRadius: radius.md }}>
            <Text mono variant="caption" selectable style={{ padding: space.sm }}>
              {text.slice(0, 60_000)}
            </Text>
          </ScrollView>
        )
      ) : null}
      {q.data && !isText && !mime.startsWith('image/') ? (
        <Text tone="muted">{t('No preview for {mime}.', { mime: mime || t('this file type') })}</Text>
      ) : null}
    </Sheet>
  )
}
