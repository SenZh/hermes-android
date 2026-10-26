import { requireOptionalNativeModule } from 'expo'

export interface LastExit {
  reason: 'crash' | 'native_crash' | 'anr' | string
  timestamp: number
  description: string
  trace: string
}

interface HermesKeepAliveModule {
  start(title: string, text: string): boolean
  update(title: string, text: string): boolean
  stop(): void
  lastExit(): LastExit | null
  acknowledgeExit(): void
  lastStartError(): string | null
}

// Android only; elsewhere (web, Expo Go) every call is a no-op.
const native = requireOptionalNativeModule<HermesKeepAliveModule>('HermesKeepAlive')

/** Keep the app (and its gateway socket) alive while the agent works in the background. */
export const KeepAlive = {
  available: !!native,
  start: (title: string, text: string) => native?.start(title, text) ?? false,
  update: (title: string, text: string) => native?.update(title, text) ?? false,
  stop: () => native?.stop(),
  /** Why the last foreground promotion failed; null when it succeeded. */
  lastStartError: (): string | null => native?.lastStartError() ?? null,
}

/** Report of the last unexpected exit; null when absent, already seen, or unsupported. */
export const CrashReport = {
  lastExit: (): LastExit | null => native?.lastExit() ?? null,
  acknowledge: () => native?.acknowledgeExit(),
}
