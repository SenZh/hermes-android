/**
 * 会话工作区路径：运行时向服务端要，不在客户端硬编码。
 *
 * 不同部署的 HERMES_HOME / workspace 完全不同（本机是 /opt/data/workspace，别处可能是别的），
 * 把前缀写死会让提示词里的示例路径在其它部署上直接指向不存在的目录。
 */

export type WorkspaceInfo = {
  /** 服务端给新会话用的默认 cwd；拿不到就是 null。 */
  defaultCwd: string | null
}

let cached: WorkspaceInfo | null = null

/**
 * 取一次就缓存。工作区在一次会话生命周期内不会变，重复请求没有意义。
 * 任何失败都返回 `defaultCwd: null`，调用方必须能接受"不知道"而不是猜。
 */
export async function resolveWorkspaceInfo(
  fetchJson: (path: string) => Promise<unknown>,
  force = false,
): Promise<WorkspaceInfo> {
  if (!force && cached) return cached
  try {
    const raw = (await fetchJson('/api/chat/workspaces')) as {
      default_cwd?: unknown
    } | null
    const cwd = typeof raw?.default_cwd === 'string' && raw.default_cwd.trim() ? raw.default_cwd.trim() : null
    cached = { defaultCwd: cwd }
  } catch {
    cached = { defaultCwd: null }
  }
  return cached
}

/** 测试与登出用。 */
export function resetWorkspaceInfoCache() {
  cached = null
}
