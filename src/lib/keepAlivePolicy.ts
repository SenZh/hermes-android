/**
 * Keep-alive policy: pure decision logic for the Android foreground service.
 *
 * Android books every `startForegroundService()` call and demands a matching
 * `startForeground()` within a few seconds. Stopping the service before that promotion
 * is the same violation as never promoting it, so the only safe moves are "do not post"
 * and "wait long enough that the previous teardown has finished". Those two decisions
 * live here so they can be tested for real instead of being buried in a component.
 */

/** How long after a stop before the next start may be posted. */
export const STOP_COOLDOWN_MS = 300

/** First retry delay after a refused start. */
const BACKOFF_BASE_MS = 1000
/** Ceiling for the retry delay. */
const BACKOFF_CAP_MS = 30_000

/**
 * Whether a start may be posted now.
 *
 * `lastStopAt <= 0` means the service was never stopped in this session, so there is
 * nothing to wait for. Otherwise the teardown triggered by that stop is asynchronous and
 * a start posted inside the cooldown can interleave with it, leaving a foreground
 * requirement nobody ever satisfies.
 */
export function canStartNow(now: number, lastStopAt: number, cooldownMs = STOP_COOLDOWN_MS): boolean {
  if (lastStopAt <= 0) return true
  if (cooldownMs <= 0) return true
  return now - lastStopAt >= cooldownMs
}

/**
 * Delay before retrying a refused start: doubles per consecutive failure, capped at 30s,
 * zero when the last attempt succeeded (or never happened).
 */
export function nextBackoffMs(
  failStreak: number,
  base = BACKOFF_BASE_MS,
  cap = BACKOFF_CAP_MS,
): number {
  if (!Number.isFinite(failStreak) || failStreak <= 0) return 0
  if (base <= 0 || cap <= 0) return 0
  return Math.min(base * 2 ** (failStreak - 1), cap)
}

export type StartDecision =
  /** Post the start now. */
  | { action: 'start' }
  /** Do not post yet; wake up again after `delayMs` so the request is not dropped. */
  | { action: 'wait'; delayMs: number }
  /** Nothing to do: already running, or the app is in the background. */
  | { action: 'skip'; reason: 'running' | 'background' }

/**
 * The whole "may I post a start right now?" decision, in one testable place.
 *
 * Keeping this out of the component is what makes it verifiable: the cooldown and backoff gates
 * determine whether Android is ever handed a start it cannot satisfy, so they must not live in
 * code that only a real device can exercise.
 */
export function decideStart(args: {
  running: boolean
  foreground: boolean
  now: number
  lastStopAt: number
  retryAfter: number
  cooldownMs?: number
}): StartDecision {
  const { running, foreground, now, lastStopAt, retryAfter } = args
  if (running) return { action: 'skip', reason: 'running' }
  if (!foreground) return { action: 'skip', reason: 'background' }

  const cooldown = args.cooldownMs ?? STOP_COOLDOWN_MS
  if (!canStartNow(now, lastStopAt, cooldown)) {
    return { action: 'wait', delayMs: Math.max(0, lastStopAt + cooldown - now) }
  }
  if (now < retryAfter) {
    return { action: 'wait', delayMs: retryAfter - now }
  }
  return { action: 'start' }
}
