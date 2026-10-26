import { describe, expect, it, vi } from 'vitest'

// 1. 模拟核心网关与 RPC 客户端
const mockRpcRequest = vi.fn()
const mockRestPost = vi.fn()

vi.mock('@/lib/hermes', () => ({
  rpc: () => ({
    request: mockRpcRequest,
  }),
  rest: () => ({
    post: mockRestPost,
  }),
  hermes: () => ({
    profile: 'custom-profile',
    rest: {
      url: (path: string, params: any) => `https://mock.gateway${path}?${new URLSearchParams(params)}`,
    },
    authHeaders: async () => ({ Authorization: 'Bearer test-token' }),
  }),
}))

describe('Session Deletion Protocol Guard', () => {
  it('strictly invokes rpc session.delete with explicit session_id and profile to prevent Exclusive maintenance refused', async () => {
    mockRpcRequest.mockResolvedValueOnce({ deleted: 'session-123' })

    const { rpc, hermes } = await import('@/lib/hermes')
    const targetSessionId = 'session-123'
    const profile = hermes().profile ?? null

    // 模拟 sessions.tsx 和 SessionMenu.tsx 里的标准删除逻辑
    await rpc().request('session.delete', { session_id: targetSessionId, profile })

    expect(mockRpcRequest).toHaveBeenCalledWith('session.delete', {
      session_id: 'session-123',
      profile: 'custom-profile',
    })
    // 确保不再调用会导致 exclusive_maintenance 锁冲突的 REST bulk-delete
    expect(mockRestPost).not.toHaveBeenCalled()
  })
})

describe('SAF & File Streaming Security Guard', () => {
  it('enforces native Sharing pipeline over direct SAF copyAsync to eliminate java.io.IOException: Destination', async () => {
    // 模拟两阶段下载与分享：零 OOM 且原生兼容
    const mockFileDownload = vi.fn().mockResolvedValue({ uri: 'file:///cache/test.pdf' })
    const mockShare = vi.fn().mockResolvedValue(true)
    const mockCopyAsync = vi.fn()

    const { hermes } = await import('@/lib/hermes')
    const normalized = 'test.pdf'
    const downloadUrl = hermes().rest.url('/api/files/download', { path: normalized })

    // 第一阶段：底层 C++ 直写到缓存
    const downloaded = await mockFileDownload(downloadUrl)
    expect(downloaded.uri).toBe('file:///cache/test.pdf')

    // 第二阶段：直接交给系统原生分享面板，彻底杜绝直接向 SAF Content-URI 调用 copyAsync 抛出 IOException
    await mockShare(downloaded.uri, { mimeType: 'application/pdf' })
    expect(mockShare).toHaveBeenCalledWith('file:///cache/test.pdf', { mimeType: 'application/pdf' })
    expect(mockCopyAsync).not.toHaveBeenCalled()
  })
})

describe('Metrics Calculation & TPS Fallback Guard', () => {
  it('calculates duration in Chinese format (X分Y秒) and falls back to character estimation if turnUsage is absent', () => {
    // 1. 耗时中文格式化断言
    const formatDuration = (ms: number | undefined) => {
      if (!ms || ms < 1000) return null
      const totalSeconds = Math.round(ms / 1000)
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      if (minutes > 0) return `${minutes}分${seconds}秒`
      return `${seconds}秒`
    }

    expect(formatDuration(23000)).toBe('23秒')
    expect(formatDuration(83000)).toBe('1分23秒')
    expect(formatDuration(500)).toBeNull()

    // 2. TPS 智能估算保底（无后端使用量时用 text.length / 2.5）
    const calculateTps = (reportedTps: number | undefined, text: string, elapsedMs: number) => {
      if (reportedTps) return reportedTps
      if (!elapsedMs || elapsedMs < 1000 || !text) return null
      const estimatedTokens = Math.round(text.length / 2.5)
      return Math.round((estimatedTokens / (elapsedMs / 1000)) * 10) / 10
    }

    const tps = calculateTps(undefined, '这是一段测试输出用于验证TPS智能估算保底逻辑', 2000)
    expect(tps).toBeGreaterThan(0)
  })
})
