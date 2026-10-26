import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import { create } from 'zustand'

export interface UpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  currentVersion: string
  body?: string
  downloadUrl?: string
  checkedAt: number
}

interface UpdaterState {
  info: UpdateInfo | null
  checking: boolean
  lastChecked: number
  check: (silent?: boolean) => Promise<UpdateInfo | null>
}

// 简单的 Semver 版本比较：v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
export function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const clean2 = v2.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(clean1.length, clean2.length)
  for (let i = 0; i < len; i++) {
    const num1 = clean1[i] ?? 0
    const num2 = clean2[i] ?? 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}

export const useUpdater = create<UpdaterState>((set, get) => ({
  info: null,
  checking: false,
  lastChecked: 0,

  check: async (silent = true) => {
    if (get().checking) return get().info
    set({ checking: true })

    const currentVersion = Constants.expoConfig?.version ?? '1.8.3'
    try {
      const resp = await fetch('https://api.github.com/repos/SenZh/hermes-android/releases', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const releases = await resp.json()
      if (!Array.isArray(releases) || !releases.length) throw new Error('No releases found')

      // 取最新的 Release（优先正规 release，没有则取首个）
      const latest = releases[0]
      const latestVersion = (latest.tag_name as string).replace(/^v/, '')
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0

      let downloadUrl = latest.html_url
      const apkAsset = latest.assets?.find((a: any) => a.name?.endsWith('.apk'))
      if (apkAsset?.browser_download_url) {
        downloadUrl = apkAsset.browser_download_url
      }

      const info: UpdateInfo = {
        hasUpdate,
        latestVersion,
        currentVersion,
        body: latest.body || '',
        downloadUrl,
        checkedAt: Date.now(),
      }

      set({ info, checking: false, lastChecked: Date.now() })
      return info
    } catch (e) {
      if (!silent) throw e
      set({ checking: false })
      return null
    }
  },
}))

let timerStarted = false
export function initAutoUpdater() {
  if (timerStarted) return
  timerStarted = true

  // 1. 冷启动时静默检查一次
  setTimeout(() => {
    useUpdater.getState().check(true).catch(() => {})
  }, 3000)

  // 2. 每隔 1 小时检查一次
  setInterval(() => {
    useUpdater.getState().check(true).catch(() => {})
  }, 3600 * 1000)
}
