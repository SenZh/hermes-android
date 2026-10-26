import { Stack, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import { Image } from 'expo-image'
import * as Sharing from 'expo-sharing'
import { useState } from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { Markdown } from '@/components/chat/Markdown'
import { Download, Share2 } from '@/components/icons'
import { Button, ErrorState, IconButton, Loading, Screen, Text, toast, toastError } from '@/components/ui'
import { useT } from '@/i18n'
import { bytes } from '@/lib/format'
import { hermes } from '@/lib/hermes'
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

  const [allowLargeLoad, setAllowLargeLoad] = useState(false)

  // 1. 标准化路径：
  let p = rawPath
    .replace(/^sandbox:\/?\/?/, '')
    .replace(/^\.\//, '')
    .trim()

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

  // 预判文件类型与可能的大小提示
  const isCodeOrTextExt = /\.(md|txt|py|ts|tsx|js|json|ya?ml|toml|sh|log|ini|cfg|env|rs|go|java|kt|c|h|cpp|css|html|sql|xml|patch|diff)$/i.test(fileName)
  const isImageExt = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName)
  const isLikelyLargeBinary = !isCodeOrTextExt && !isImageExt

  // 超过 5MB 的文件禁止自动请求 base64 /api/files/read，必须由用户主动点击确认
  const shouldAutoLoad = !isLikelyLargeBinary || allowLargeLoad

  const q = useRest<{ data_url: string; mime_type: string; size?: number }>(
    ['file-read', normalized],
    '/api/files/read',
    { path: normalized },
    { enabled: !!normalized && !isSystemRestricted && shouldAutoLoad },
  )

  const mime = q.data?.mime_type ?? ''
  const b64 = q.data?.data_url ? q.data.data_url.slice(q.data.data_url.indexOf(',') + 1) : ''
  const fileSize = q.data?.size ?? 0
  const isLarge = fileSize > 5 * 1024 * 1024

  const isText =
    !isLarge &&
    (/^text\/|json|yaml|xml|javascript|typescript|x-sh|toml/.test(mime) || isCodeOrTextExt)

  let text = ''
  if (isText && b64) {
    try {
      text = decodeBase64Utf8(b64)
    } catch {
      text = ''
    }
  }

  // 本地持久化缓存单例文件对象：避免重复下载
  async function getOrDownloadLocalFile(onProgressText?: string): Promise<File> {
    const cached = new File(Paths.cache, fileName)
    if (cached.exists && cached.size > 0) {
      return cached
    }
    if (onProgressText) toast(onProgressText, 'info')
    const url = hermes().rest.url('/api/files/download', { path: normalized })
    return await File.downloadFileAsync(url, cached, { headers: await hermes().authHeaders() })
  }

  // 快捷分享（优先复用已下载缓存）
  async function share() {
    if (!normalized || isSystemRestricted) return
    try {
      if (Platform.OS === 'web') return toast(t('Sharing is available in the Android app.'), 'info')
      const file = await getOrDownloadLocalFile(t('Preparing file…'))
      await Sharing.shareAsync(file.uri, { mimeType: mime || undefined })
    } catch (e) {
      toastError(e)
    }
  }

  // 真正的文件落盘保存（保存到外部公共存储 Downloads 目录）
  const SAVED_SAF_DIR_KEY = 'hermes_download_saf_dir_uri'

  async function download() {
    if (!normalized || isSystemRestricted) return
    try {
      if (Platform.OS === 'web') return toast(t('Downloading is available in the Android app.'), 'info')

      // 1. 获取或流式下载本地缓存（如果已经下载过，零网络请求秒级读取）
      const localFile = await getOrDownloadLocalFile(t('Downloading {name}…', { name: fileName }))

      // 2. 选择或读取已授权的外部目录
      let targetDirUri = await AsyncStorage.getItem(SAVED_SAF_DIR_KEY)
      if (!targetDirUri) {
        const picked = await Directory.pickDirectoryAsync()
        if (!picked || !picked.uri) return
        targetDirUri = picked.uri
        await AsyncStorage.setItem(SAVED_SAF_DIR_KEY, targetDirUri)
      }

      toast(t('Saving to disk…'), 'info')
      const targetDir = new Directory(targetDirUri)
      
      // 3. 利用 expo-file-system 官方新架构 File.copy() 原生底核流式拷贝
      // 底层由 Java/Kotlin FileSystemModule.copy -> DestinationSink.SAF 直接通过 FileChannel 写入 SAF Content-URI
      // 绝不经过 JS 内存，绝无 Base64，彻底根除 OOM！
      await localFile.copy(targetDir)

      // 解析用户可读的目录名称并友好展示
      let displayFolder = 'Downloads'
      try {
        const decoded = decodeURIComponent(targetDirUri)
        const parts = decoded.split(':')
        if (parts.length > 1) {
          displayFolder = parts[parts.length - 1]
        }
      } catch {}

      toast(t('Saved to {folder}: {name}', { folder: displayFolder, name: fileName }), 'success')
    } catch (e: any) {
      // 若原授权目录失效，清除缓存让用户下次重新选择
      await AsyncStorage.removeItem(SAVED_SAF_DIR_KEY)
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

      {!shouldAutoLoad ? (
        <View style={{ padding: space.xl, alignItems: 'center', gap: space.md, marginTop: space.xxl }}>
          <Text weight="semibold" variant="title">
            {fileName}
          </Text>
          <Text tone="muted" style={{ textAlign: 'center' }}>
            {t('This file is not a common text format. It may be large and consume data to preview.')}
          </Text>
          <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
            <Button label={t('Preview anyway')} variant="secondary" onPress={() => setAllowLargeLoad(true)} />
            <Button label={t('Download')} variant="primary" icon={Download} onPress={download} />
          </View>
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

      {q.data && isLarge ? (
        <View style={{ padding: space.lg, alignItems: 'center' }}>
          <Text tone="muted">{t('Too large to preview. Download it instead.')}</Text>
        </View>
      ) : null}

      {q.data && !isText && !isLarge && !mime.startsWith('image/') ? (
        <View style={{ padding: space.lg, alignItems: 'center' }}>
          <Text tone="muted">{t('No preview for {mime}.', { mime: mime || t('this file type') })}</Text>
        </View>
      ) : null}
    </Screen>
  )
}
