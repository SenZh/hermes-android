/**
 * Formatting and estimation metrics for chat message duration and TPS throughput.
 */

export function formatDuration(ms: number | undefined | null): string | null {
  if (ms == null || ms < 1000) return null
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return remainingSeconds > 0 ? `${minutes}分${remainingSeconds}秒` : `${minutes}分钟`
}

export function calculateTps(
  reportedTps: number | undefined | null,
  text: string | undefined | null,
  elapsedMs: number | undefined | null,
): number | null {
  if (reportedTps != null && reportedTps > 0) {
    return Math.round(reportedTps * 10) / 10
  }
  if (!elapsedMs || elapsedMs < 1000 || !text) {
    return null
  }
  const estimatedTokens = Math.round(text.length / 2.5)
  if (estimatedTokens <= 0) return null
  const seconds = elapsedMs / 1000
  return Math.round((estimatedTokens / seconds) * 10) / 10
}
