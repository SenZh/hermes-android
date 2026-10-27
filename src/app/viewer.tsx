import { Stack, useLocalSearchParams } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Directory, File, Paths } from 'expo-file-system'
import * as FileSystem from 'expo-file-system/legacy'
import * as Linking from 'expo-linking'
import * as Sharing from 'expo-sharing'
import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

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
  inferMimeType,
  isPickerCancelled,
  pickCreatedEntry,
  resolveFileNameConflict,
  safeParseDownloadRecord,
  type StoredDownloadRecord,
} from '@/lib/downloadManager'
import { KeepAlive } from '../../modules/hermes-keepalive'
import { isManagedPath, normalizeManagedPath } from '@/lib/pathNormalize'
import { ZoomableImage } from '@/components/ZoomableImage'
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

  // 1. 标准化路径：纯函数在 src/lib/pathNormalize.ts，由单测真实 import 覆盖
  const normalized = normalizeManagedPath(rawPath)

  // 严格沙箱校验：最终解析出的绝对路径必须在 /opt/data 之内
  const isSystemRestricted = !isManagedPath(normalized)

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
  const [imageFullscreen, setImageFullscreen] = useState(false)
  // 全屏层会盖住状态栏，关闭按钮必须按真实安全区下移，否则刘海/挖孔屏上会被挡住
  const insets = useSafeAreaInsets()

  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // 读取持久化下载记录。记录一旦写入就以它为准展示完成态，绝不因为一次
  // 探测失败就把按钮退回"下载"；只有当真实探测到文件已不存在时，才降级成
  // "仅知道目录"的记录（仍显示打开所在目录，并提示文件可能被移走）。
  useEffect(() => {
    if (!normalized) return
    const key = getDownloadStorageKey(normalized)
    AsyncStorage.getItem(key)
      .then((raw) => {
        const record = safeParseDownloadRecord(raw)
        if (!record || !isMountedRef.current) return
        let alive = true
        if (record.targetUri) {
          try {
            alive = new File(record.targetUri).exists
          } catch {
            alive = true
          }
        }
        if (!alive) {
          const degraded: StoredDownloadRecord = { ...record, targetUri: '' }
          void AsyncStorage.setItem(key, JSON.stringify(degraded))
          setDownloadRecord(degraded)
          return
        }
        setDownloadRecord(record)
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

  // 打开已落盘的文件（调起系统默认打开方式/安装器，绝不走 expo-sharing 报 scheme 错误）
  async function openFile() {
    if (!downloadRecord) return
    if (!downloadRecord.targetUri) {
      toast(t('The saved file could not be located. Use “Open folder”.'), 'info')
      return
    }
    try {
      const resolvedMime = inferMimeType(downloadRecord.fileName, mime)
      if (Platform.OS === 'android' && KeepAlive.available) {
        KeepAlive.openFile(downloadRecord.targetUri, resolvedMime)
      } else {
        await Linking.openURL(downloadRecord.targetUri)
      }
    } catch (e) {
      toastError(e)
    }
  }

  // 打开已落盘的所在目录（定向调起系统文件管理器，绝不唤起 Google 等无关 App）
  async function openFolder() {
    const dirUri = await AsyncStorage.getItem(SAVED_SAF_DIR_KEY)
    if (!dirUri) {
      toast(t('Download directory not set.'), 'info')
      return
    }
    try {
      if (Platform.OS === 'android' && KeepAlive.available) {
        // 四层降级全部失败时会返回 false；静默会让用户以为点击没生效
        if (!KeepAlive.openFolder(dirUri)) {
          toast(t('Saved folder: {folder}', { folder: downloadRecord?.targetFolder || 'Downloads' }), 'info')
        }
      } else {
        await Linking.openURL(dirUri)
      }
    } catch {
      toast(t('Saved folder: {folder}', { folder: downloadRecord?.targetFolder || 'Downloads' }), 'info')
    }
  }

  // 执行核心下载并落盘
  async function startDownloadAndExport(onPreviewInstead = false) {
    if (!normalized || isSystemRestricted || isDownloading) return
    if (Platform.OS === 'web') return toast(t('Downloading is available in the Android app.'), 'info')

    try {
      // 1. 前置选目录：每次都弹系统目录选择器，默认定位到上次用过的目录，用户可随时切换。
      //    未确认目录前不发起任何网络请求，取消则零流量消耗。
      const lastDirUri = await AsyncStorage.getItem(SAVED_SAF_DIR_KEY)
      let picked: Directory
      try {
        picked = await Directory.pickDirectoryAsync(lastDirUri ?? undefined)
      } catch (e) {
        // 取消不是错误：expo 以 PickerCancelledException 抛出，必须静默返回
        if (isPickerCancelled(e)) return
        throw e
      }
      const targetDirUri = picked.uri
      if (targetDirUri !== lastDirUri) await AsyncStorage.setItem(SAVED_SAF_DIR_KEY, targetDirUri)

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

      // 2. 检查目标目录下是否存在同名冲突（顺手记下现有文件名，落盘后用来认领真实条目）
      let finalTargetName = fileName
      let shouldOverwrite = false
      let beforeNames: string[] = []
      try {
        const entries = targetDir.list()
        beforeNames = entries.map((e) => e.name).filter(Boolean) as string[]

        if (beforeNames.includes(fileName)) {
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
            finalTargetName = resolveFileNameConflict(fileName, beforeNames, 'rename')
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
      // 目标必须传 Directory 而不是 new File(dir, name)：SAF 下前者走
      // CopyMoveStrategy.SAF 的 container 分支，由底层 DocumentFile.createFile 建出真实
      // document 并写入；后者只是 Tree URI 拼路径，会被 DocumentFile.fromTreeUri 解析成
      // 目录本身（exists()==true 且 isDirectory()==true），首次下载即抛
      // InvalidTypeFileException，覆盖分支更会删掉整个所选目录。
      await downloadedLocalFile.copy(targetDir, { overwrite: shouldOverwrite })

      // 及时清理私有缓存中的临时下载副本，释放手机内部空间
      try {
        if (downloadedLocalFile.exists) downloadedLocalFile.delete()
      } catch {}

      // 5. 认领真实落盘条目的 document URI
      // `new File(dir, name).uri` 只是 Tree URI 拼路径的伪子 URI，写进记录后
      // 重进页面 exists 恒为 false，完成态会丢失。必须回到目录里按新增条目取真实 URI。
      let realUri = ''
      let realName = finalTargetName
      try {
        const after = targetDir.list().map((e) => ({ name: e.name ?? null, uri: e.uri }))
        const created = pickCreatedEntry(beforeNames, after, finalTargetName)
        if (created && created.name) {
          realUri = created.uri
          realName = created.name
        }
      } catch {}

      const record: StoredDownloadRecord = {
        targetUri: realUri,
        fileName: realName,
        targetFolder: displayFolder,
        downloadedAt: Date.now(),
        fileSize: downloadTotalBytes || 0,
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
                {downloadRecord && downloadRecord.targetUri ? (
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

      {/* 已保存态通条：文本 / Markdown / 图片这类可直接预览的文件，下载完成后同样
          给出【打开文件】与【打开所在目录】，不再保留任何"下载"入口。 */}
      {shouldAutoLoad && downloadRecord ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.xs,
            marginVertical: space.sm,
            paddingVertical: space.xs,
            paddingHorizontal: space.sm,
            borderRadius: radius.md,
            backgroundColor: c.surfaceAlt,
          }}
        >
          <CheckCircle2 size={16} color={c.accentText} />
          <Text variant="caption" tone="accent" numberOfLines={1} style={{ flex: 1 }}>
            {t('Saved to {folder}: {name}', {
              folder: downloadRecord.targetFolder,
              name: downloadRecord.fileName,
            })}
            {downloadRecord.targetUri ? '' : ` · ${t('file may have been moved')}`}
          </Text>
          <IconButton icon={FileText} label={t('Open file')} onPress={openFile} />
          <IconButton icon={FolderOpen} label={t('Open folder')} onPress={openFolder} />
          {downloadRecord.targetUri ? null : (
            <IconButton
              icon={Download}
              label={t('Download')}
              disabled={isDownloading}
              onPress={() => startDownloadAndExport(false)}
            />
          )}
        </View>
      ) : null}

      {shouldAutoLoad && !downloadRecord && isDownloading ? (
        <View style={{ width: '100%', gap: space.xs, marginVertical: space.sm }}>
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
        <View style={{ width: '100%', aspectRatio: 1, borderRadius: radius.md, overflow: 'hidden' }}>
          <ZoomableImage uri={q.data.data_url} enablePan={false} onSingleTap={() => setImageFullscreen(true)} />
        </View>
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

      {/* 全屏图片：单击退出，捏合/双击缩放，放大后拖动。
          必须用 Modal —— <Screen> 默认 scroll=true，absoluteFill 只会覆盖滚动内容区，
          还会被滚走、header 也盖不住，等于没全屏。 */}
      <Modal
        visible={imageFullscreen && !!q.data}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setImageFullscreen(false)}
      >
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
          {q.data ? (
            <ZoomableImage uri={q.data.data_url} background="#000" onSingleTap={() => setImageFullscreen(false)} />
          ) : null}
          <Pressable
            onPress={() => setImageFullscreen(false)}
            hitSlop={12}
            style={{ position: 'absolute', top: insets.top + 12, right: 20, padding: 8 }}
          >
            <Text style={{ color: '#fff', fontSize: 15 }}>{t('Done')}</Text>
          </Pressable>
        </GestureHandlerRootView>
      </Modal>
    </Screen>
  )
}
