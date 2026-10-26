import * as Notifications from 'expo-notifications'
import { router, useRootNavigationState } from 'expo-router'
import { useEffect, useRef } from 'react'
import { AppState, Platform } from 'react-native'

import { toast } from '@/components/ui/Dialogs'
import { t } from '@/i18n'
import { syncCronBackgroundCheck } from '@/lib/backgroundTasks'
import { textOf } from '@/lib/chat/types'
import { useCronWatch } from '@/lib/cronWatch'
import { useRuntime } from '@/lib/hermes'
import { canStartNow, nextBackoffMs, STOP_COOLDOWN_MS } from '@/lib/keepAlivePolicy'
import { CHANNELS, notificationPermission, notify } from '@/lib/notify'
import { speak } from '@/lib/voice'
import { answerRequest, onTurnComplete, setActive, useChat } from '@/store/chat'
import { useConnections } from '@/store/connections'
import { useSettings } from '@/store/settings'

import { KeepAlive } from '../../../modules/hermes-keepalive'

const APPROVAL_CATEGORY = 'hermes-approval'

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  })
}

/** Request id → the notification that announced it, so answering in the app clears it. */
const requestNotifications = new Map<string, string>()
/** Request ids already announced; bounded so a long session cannot grow it forever. */
const notifiedRequests = new Set<string>()
/** response identifier + action, so a cold-start response re-delivered to the listener fires once. */
const handledResponses = new Set<string>()

function remember(set: Set<string>, key: string, cap = 128) {
  set.add(key)
  if (set.size > cap) set.delete(set.values().next().value!)
}

/** Where a tapped notification lands: the live chat, a stored one, or the cron list. */
function routeToContent(data: { sessionId?: string; storedId?: string | null; cronJobId?: string }) {
  if (data.sessionId && useChat.getState().sessions[data.sessionId]) {
    setActive(data.sessionId)
    router.navigate('/chat')
  } else if (data.storedId) {
    // The chat screen waits for the socket before opening the stored session.
    router.navigate({ pathname: '/chat', params: { stored: data.storedId } })
  } else if (data.cronJobId) {
    router.navigate('/cron')
  } else {
    router.navigate('/chat')
  }
}

function handleResponse(response: Notifications.NotificationResponse) {
  const key = `${response.notification.request.identifier}|${response.actionIdentifier}`
  if (handledResponses.has(key)) return
  remember(handledResponses, key)
  const data = response.notification.request.content.data as {
    sessionId?: string
    storedId?: string
    requestId?: string
    approvalId?: string
    cronJobId?: string
  }
  const action = response.actionIdentifier
  // Both buttons bring the app forward: the answer travels over the gateway socket.
  if ((action === 'once' || action === 'deny') && data.requestId) answerRequest(data.requestId, { choice: action }, data.approvalId)
  routeToContent(data)
  void Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {})
}

/**
 * While any chat is working or waiting on the user, hold a foreground service so Android does not
 * freeze the app (and drop the gateway socket) once it is in the background.
 *
 * The bookkeeping below lives at module scope on purpose: this effect remounts on navigation, and a
 * stop from one instance followed by a start from the next is what leaves Android waiting for a
 * startForeground() that never comes. Sharing the timestamps keeps the cooldown effective across
 * mounts.
 */
let lastStopAt = 0
let failStreak = 0
let retryAfter = 0

function useKeepAlive() {
  useEffect(() => {
    if (Platform.OS !== 'android' || !KeepAlive.available) return
    let running = false
    let shown = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const sync = () => {
      const { sessions, requests } = useChat.getState()
      const busy = Object.values(sessions).filter((s) => s.busy)
      const want = useSettings.getState().keepAlive && (busy.length > 0 || requests.length > 0)
      if (!want) {
        if (running) {
          KeepAlive.stop()
          lastStopAt = Date.now()
          failStreak = 0
          retryAfter = 0
        }
        running = false
        shown = ''
        return
      }
      const title = requests.length ? t('Hermes needs your input') : t('Hermes is working')
      const lead = busy[0]
      const text = requests.length
        ? t('Open the app to answer')
        : [lead?.title, lead?.status].filter(Boolean).join(' · ') || t('Working on your request')
      const label = `${title}|${text}`
      if (label === shown) return
      if (running && !KeepAlive.update(title, text)) {
        // The service died underneath us (timeout cap, task swipe). Stop it explicitly so the
        // next start is not posted on top of a half-dead instance, then re-arm from scratch.
        KeepAlive.stop()
        running = false
        shown = ''
        lastStopAt = Date.now()
      }
      if (!running) {
        const now = Date.now()
        // Starting only from the foreground. A start posted right after a stop can interleave
        // with the pending teardown and leave Android waiting forever for startForeground().
        if (AppState.currentState !== 'active') return
        if (!canStartNow(now, lastStopAt)) {
          // Cooldown must delay, not drop: wake up when it expires instead of waiting for the
          // next unrelated store change (which may never come).
          if (timer) clearTimeout(timer)
          timer = setTimeout(sync, Math.max(0, lastStopAt + STOP_COOLDOWN_MS - now) + 20)
          return
        }
        if (now < retryAfter) return
        const ok = KeepAlive.start(title, text)
        running = ok
        if (ok) {
          shown = label
          failStreak = 0
          retryAfter = 0
        } else {
          failStreak += 1
          const delay = nextBackoffMs(failStreak)
          retryAfter = now + delay
          // Nothing else will nudge us when the backoff expires, so schedule the retry ourselves.
          if (timer) clearTimeout(timer)
          timer = setTimeout(sync, delay + 20)
        }
      } else {
        shown = label
      }
    }
    const offChat = useChat.subscribe(sync)
    const offSettings = useSettings.subscribe(sync)
    const offApp = AppState.addEventListener('change', (state) => state === 'active' && sync())
    sync()
    return () => {
      offChat()
      offSettings()
      offApp.remove()
      if (timer) clearTimeout(timer)
      if (running) {
        KeepAlive.stop()
        lastStopAt = Date.now()
      }
    }
  }, [])
}

/** POST_NOTIFICATIONS is never asked unless a toggle forced it; ask once Hermes is actually in use. */
function useNotificationPermission() {
  const state = useRuntime((s) => s.state)
  const asked = useRef(false)
  useEffect(() => {
    if (state !== 'open' || asked.current) return
    asked.current = true
    const { notifyOnComplete, notifyCron } = useSettings.getState()
    if (notifyOnComplete || notifyCron) void notificationPermission(true)
  }, [state])
}

/** The WorkManager cron check runs while the app is dead; keep its registration in sync. */
function useCronBackgroundSync() {
  const notifyCron = useSettings((s) => s.notifyCron)
  const hasConnection = useConnections((s) => s.connections.some((c) => c.id === s.activeId))
  useEffect(() => {
    void syncCronBackgroundCheck(notifyCron && hasConnection)
  }, [notifyCron, hasConnection])
}

/** Side effects of a finished turn: read it aloud, or notify when the app is in the background. */
export function TurnEffects() {
  useKeepAlive()
  useCronWatch()
  useCronBackgroundSync()
  useNotificationPermission()
  const navReady = !!useRootNavigationState()?.key

  useEffect(
    () =>
      onTurnComplete((session, message) => {
        const { autoSpeak, notifyOnComplete } = useSettings.getState()
        const text = message ? textOf(message) : ''
        const foreground = AppState.currentState === 'active'
        const isActive = useChat.getState().activeId === session.runtimeId
        if (autoSpeak && foreground && text && isActive) void speak(text)
        if (!notifyOnComplete) return
        if (foreground) {
          // A turn ending in another chat still deserves a heads-up while this one is on screen.
          if (!isActive) toast(t('"{title}" finished', { title: session.title || 'Hermes' }), message?.error ? 'warn' : 'success')
          return
        }
        void notify(CHANNELS.turns, {
          title: session.title || t('Hermes finished'),
          body: message?.error ? message.error : text.slice(0, 180) || t('The agent finished its turn.'),
          data: { storedId: session.storedId, sessionId: session.runtimeId },
        })
      }),
    [],
  )

  // A notification tapped to launch the app is waiting here, not in the listener registered below.
  useEffect(() => {
    if (Platform.OS === 'web' || !navReady) return
    const response = Notifications.getLastNotificationResponse()
    if (response) {
      handleResponse(response)
      Notifications.clearLastNotificationResponse()
    }
  }, [navReady])

  // Approve or deny straight from the notification. Both buttons bring the app forward: the answer
  // travels over the gateway socket, which only a running app has.
  useEffect(() => {
    if (Platform.OS === 'web') return
    void Notifications.setNotificationCategoryAsync(APPROVAL_CATEGORY, [
      { identifier: 'once', buttonTitle: t('Allow once'), options: { opensAppToForeground: true } },
      { identifier: 'deny', buttonTitle: t('Deny'), options: { opensAppToForeground: true, isDestructive: true } },
    ]).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse)
    return () => sub.remove()
  }, [])

  // Agent questions (approvals, clarify, passwords) need the user even while the app is closed.
  useEffect(
    () =>
      useChat.subscribe((state, prev) => {
        if (Platform.OS === 'web') return
        // Answered in the app (or elsewhere): take its notification down.
        for (const [id, notificationId] of requestNotifications) {
          if (!state.requests.some((r) => r.id === id)) {
            requestNotifications.delete(id)
            void Notifications.dismissNotificationAsync(notificationId).catch(() => {})
          }
        }
        if (AppState.currentState === 'active') return
        const prevIds = new Set(prev.requests.map((r) => r.id))
        for (const req of state.requests) {
          if (prevIds.has(req.id) || notifiedRequests.has(req.id)) continue
          remember(notifiedRequests, req.id)
          const params = req.params as { command?: string; prompt?: string; choices?: string[]; request_id?: string }
          // With the app locked, lock-screen Allow/Deny would bypass the fingerprint gate.
          const locked = useSettings.getState().appLock
          const approval = !locked && req.method === 'approval' && (!params.choices?.length || params.choices.includes('once'))
          void notify(CHANNELS.requests, {
            title: req.method === 'approval' ? t('Approval needed') : t('Hermes needs your input'),
            body: locked ? t('Open Hermes to review it.') : String(params.command ?? params.prompt ?? ''),
            data: { sessionId: req.sessionId, requestId: req.id, approvalId: params.request_id },
            ...(approval ? { categoryIdentifier: APPROVAL_CATEGORY } : {}),
          }).then((id) => {
            if (id) requestNotifications.set(req.id, id)
          })
        }
      }),
    [],
  )

  // Coming back to a chat, its stale "finished" / "needs you" notifications are no longer news.
  useEffect(() => {
    if (Platform.OS === 'web') return
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      const activeId = useChat.getState().activeId
      if (!activeId) return
      void Notifications.getPresentedNotificationsAsync()
        .then((shown) => {
          for (const n of shown) {
            const data = n.request.content.data as { sessionId?: string }
            if (data.sessionId === activeId) void Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {})
          }
        })
        .catch(() => {})
    })
    return () => sub.remove()
  }, [])

  return null
}
