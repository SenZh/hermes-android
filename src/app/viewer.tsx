import { Stack, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import { Image } from 'expo-image'
import * as Linking from 'expo-linking'
import * as Sharing from 'expo-sharing'
import { useEffect, useRef, useState } from 'react'
import { Alert, Platform, ScrollView, View } from 'react-native'

import { Markdown } from '@/components/chat/Markdown'
import { CheckCircle2, Download, ExternalLink, FileText, FolderOpen, Share2 } from '@/components/icons'
import { Button, ErrorState, IconButton, Loading, Screen, Text, toast, toastError } from '@/components/ui'
import { useT } from '@/i18n'
import { bytes } from '@/lib/format'
import { hermes } from '@/lib/hermes'
import { useRest } from '@/lib/hooks'
import {
  calculateDownloadSpeed,
  getDownloadStorageKey,
  resolveFileNameConflict,
  safeParseDownloadRecord,
  type StoredDownloadRecord,
} from '@/lib/downloadManager'
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

  const [downloadedText, setDownloadedText] = useState('')
  const [downloadRecord, setDownloadRecord] = useState<StoredDownloadRecord | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [downloadSpeed, setDownloadSpeed] = useState('')
  const [downloadBytesWritten, setDownloadBytesWritten] = useState(0)
  const [downloadTotalBytes, setDownloadTotalBytes] = useState(0)

  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // 检查是否已有落盘成功的持久化记录并核验物理文件依然存在
  useEffect(() => {
    if (!normalized) return
    const key = getDownloadStorageKey(normalized)
    AsyncStorage.getItem(key)
      .then((raw) => {
        const record = safeParseDownloadRecord(raw)
        if (record && isMountedRef.current) {
          // 契约校验：检查物理文件是否仍有效存在，防止用户在外部系统删了文件后 App 陷入假完成态
          const fileCheck = new File(record.targetUri)
          if (fileCheck.exists) {
            setDownloadRecord(record)
          } else {
            // 文件已被外部删除，自动清除记录并恢复为未下载态
            void AsyncStorage.removeItem(key)
            setDownloadRecord(null)
          }
        }
      })
      .catch(() => {})
  }, [normalized])

  let text = downloadedText
  if (!text && isText && b64) {
    try {
      text = decodeBase64Utf8(b64)
    } catch {
      text = ''
    }
  }

  // 真正的文件落盘保存（保存到外部公共存储 Downloads 目录）
  const SAVED_SAF_DIR_KEY = 'hermes_download_saf_dir_uri'

  // 打开已落盘的文件
  async function openFile() {
    if (!downloadRecord?.targetUri) return
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadRecord.targetUri, {
          mimeType: mime || undefined,
          dialogTitle: t('Open {name}', { name: downloadRecord.fileName }),
        })
      } else {
        await Linking.openURL(downloadRecord.targetUri)
      }
    } catch (e) {
      toastError(e)
    }
  }

  // 打开已落盘的所在目录
  async function openFolder() {
    const dirUri = await AsyncStorage.getItem(SAVED_SAF_DIR_KEY)
    if (!dirUri) {
      toast(t('Download directory not set.'), 'info')
      return
    }
    try {
      await Linking.openURL(dirUri)
    } catch {
      toast(t('Saved folder: {folder}', { folder: downloadRecord?.targetFolder || 'Downloads' }), 'info')
    }
  }

  // 执行核心下载并落盘
  async function startDownloadAndExport(onPreviewInstead = false) {
    if (!normalized || isSystemRestricted || isDownloading) return
    if (Platform.OS === 'web') return toast(t('Downloading is available in the Android app.'), 'info')

    try {
      // 1. 前置确定外部目录（若无则先选目录，用户取消直接中断，零流量消耗）
      let targetDirUri = await AsyncStorage.getItem(SAVED_SAF_DIR_KEY)
      if (!targetDirUri) {
        const picked = await Directory.pickDirectoryAsync()
        if (!picked || !picked.uri) return
        targetDirUri = picked.uri
        await AsyncStorage.setItem(SAVED_SAF_DIR_KEY, targetDirUri)
      }

      const targetDir = new Directory(targetDirUri)

      // 解析用户可读的目标文件夹名
      let displayFolder = 'Downloads'
      try {
        const decoded = decodeURIComponent(targetDirUri)
        const parts = decoded.split(':')
        if (parts.length > 1) {
          displayFolder = parts[parts.length - 1]
        }
      } catch {}

      // 2. 检查目标目录下是否存在同名冲突
      let finalTargetName = fileName
      let shouldOverwrite = false
      try {
        const entries = targetDir.list()
        const existingNames = entries.map((e) => e.name).filter(Boolean) as string[]

        if (existingNames.includes(fileName)) {
          // 呼出冲突决策弹窗
          const choice = await new Promise<'overwrite' | 'rename' | 'cancel'>((resolve) => {
            Alert.alert(
              t('File already exists'),
              t('A file named "{name}" already exists in {folder}. Choose an action:', {
                name: fileName,
                folder: displayFolder,
              }),
              [
                { text: t('Cancel'), style: 'cancel', onPress: () => resolve('cancel') },
                {
                  text: t('Auto Rename'),
                  onPress: () => resolve('rename'),
                },
                {
                  text: t('Overwrite'),
                  style: 'destructive',
                  onPress: () => resolve('overwrite'),
                },
              ],
              { cancelable: false },
            )
          })

          if (choice === 'cancel') return

          if (choice === 'overwrite') {
            shouldOverwrite = true
          } else {
            finalTargetName = resolveFileNameConflict(fileName, existingNames, 'rename')
          }
        }
      } catch {
        // 枚举目录失败时默认继续
      }

      // 3. 开始执行带进度与网速计算的两阶段流式下载
      setIsDownloading(true)
      setProgressPercent(0)
      setDownloadSpeed('0 KB/s')
      setDownloadBytesWritten(0)
      setDownloadTotalBytes(fileSize || 0)

      const tempCached = new File(Paths.cache, fileName)
      if (tempCached.exists) tempCached.delete()

      let lastBytes = 0
      let lastTime = Date.now()
      let lastThrottleTime = 0

      const url = hermes().rest.url('/api/files/download', { path: normalized })
      const authHeaders = await hermes().authHeaders()

      const task = File.createDownloadTask(url, tempCached, {
        headers: authHeaders,
        onProgress: ({ bytesWritten, totalBytes }) => {
          if (!isMountedRef.current) return
          const now = Date.now()
          // 150ms 节流更新 UI，防止 React Native Bridge 掉帧卡顿
          if (now - lastThrottleTime > 150 || bytesWritten === totalBytes) {
            lastThrottleTime = now
            const timeDiff = now - lastTime
            if (timeDiff >= 400) {
              const speed = calculateDownloadSpeed(lastBytes, bytesWritten, timeDiff)
              setDownloadSpeed(speed)
              lastBytes = bytesWritten
              lastTime = now
            }
            setDownloadBytesWritten(bytesWritten)
            if (totalBytes > 0) {
              setDownloadTotalBytes(totalBytes)
              setProgressPercent(Math.min(100, Math.round((bytesWritten / totalBytes) * 100)))
            }
          }
        },
      })

      const downloadedLocalFile = await task.downloadAsync()
      if (!downloadedLocalFile) throw new Error('Download aborted')

      // 若为文本预览分支，且用户选择了预览
      if (onPreviewInstead && isCodeOrTextExt) {
        const previewContent = await downloadedLocalFile.text()
        if (isMountedRef.current) {
          setDownloadedText(previewContent)
          setAllowLargeLoad(true)
          setIsDownloading(false)
        }
        toast(t('Preview loaded'), 'success')
        return
      }

      // 4. 落盘至外部目标目录
      // 若选择覆盖，必须先删除外部原同名文件以防止 Android 原生 DocumentFile 自动创建 (1) 副本
      if (shouldOverwrite) {
        try {
          const conflictFile = new File(targetDir, fileName)
          if (conflictFile.exists) conflictFile.delete()
        } catch {}
      }

      // 通过底层 FileChannel 零内存流式拷贝
      const finalDestFile = new File(targetDir, finalTargetName)
      await downloadedLocalFile.copy(finalDestFile)

      // 及时清理私有缓存中的临时下载副本，释放手机内部空间
      try {
        if (downloadedLocalFile.exists) downloadedLocalFile.delete()
      } catch {}

      const record: StoredDownloadRecord = {
        targetUri: finalDestFile.uri,
        fileName: finalTargetName,
        targetFolder: displayFolder,
        downloadedAt: Date.now(),
        fileSize: downloadTotalBytes || downloadedLocalFile.size || 0,
      }

      // 写入持久化存储
      await AsyncStorage.setItem(getDownloadStorageKey(normalized), JSON.stringify(record))

      if (isMountedRef.current) {
        setDownloadRecord(record)
        setIsDownloading(false)
      }

      toast(t('Saved to {folder}: {name}', { folder: displayFolder, name: finalTargetName }), 'success')
    } catch (e: any) {
      if (isMountedRef.current) {
        setIsDownloading(false)
      }
      toastError(e)
    }
  }

  // 快捷分享（复用本地缓存）
  async function share() {
    if (!normalized || isSystemRestricted) return
    try {
      if (Platform.OS === 'web') return toast(t('Sharing is available in the Android app.'), 'info')
      const dest = new File(Paths.cache, fileName)
      if (!dest.exists || dest.size === 0) {
        toast(t('Preparing file…'), 'info')
        const url = hermes().rest.url('/api/files/download', { path: normalized })
        await File.downloadFileAsync(url, dest, { headers: await hermes().authHeaders() })
      }
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
                {downloadRecord ? (
                  <IconButton icon={FolderOpen} label={t('Open folder')} onPress={openFolder} />
                ) : (
                  <IconButton
                    icon={Download}
                    label={t('Download')}
                    disabled={isDownloading}
                    onPress={() => startDownloadAndExport(false)}
                  />
                )}
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

          {/* 1. 已落盘完成状态：展示绿色图标与【打开文件】+【打开所在目录】 */}
          {downloadRecord ? (
            <View style={{ alignItems: 'center', gap: space.sm, width: '100%', marginTop: space.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={18} color={c.accentText} />
                <Text tone="accent" weight="medium">
                  {t('Saved to {folder}: {name}', {
                    folder: downloadRecord.targetFolder,
                    name: downloadRecord.fileName,
                  })}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.xs }}>
                <Button label={t('Open file')} variant="primary" icon={FileText} onPress={openFile} />
                <Button label={t('Open folder')} variant="secondary" icon={FolderOpen} onPress={openFolder} />
              </View>
            </View>
          ) : isDownloading ? (
            /* 2. 下载中状态：展示百分比、进度条、大小与瞬时网速 */
            <View style={{ width: '100%', alignItems: 'center', gap: space.xs, marginTop: space.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
                <Text variant="caption" weight="semibold">
                  {progressPercent}% · {downloadSpeed || '0 KB/s'}
                </Text>
                <Text variant="caption" tone="faint">
                  {bytes(downloadBytesWritten)} / {bytes(downloadTotalBytes)}
                </Text>
              </View>
              <View
                style={{
                  width: '100%',
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: c.surfaceAlt,
                  overflow: 'hidden',
                  marginVertical: 4,
                }}
              >
                <View
                  style={{
                    width: `${progressPercent}%`,
                    height: '100%',
                    backgroundColor: c.accent,
                    borderRadius: 3,
                  }}
                />
              </View>
            </View>
          ) : (
            /* 3. 未下载状态：大文本显示【下载并预览】，二进制显示【保存到本地】 */
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              <Button
                label={isCodeOrTextExt ? t('Download & Preview') : t('Save to device')}
                variant="primary"
                icon={Download}
                onPress={() => startDownloadAndExport(isCodeOrTextExt)}
              />
            </View>
          )}
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
