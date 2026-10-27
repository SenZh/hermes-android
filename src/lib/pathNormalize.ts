/**
 * 把客户端传来的文件路径规范化为后端受管目录下的绝对路径。
 *
 * 客户端可能给出三种形态：`sandbox:/output/x.md`、`./output/x.md`、`/output/x.md`，
 * 以及已经合法的 `/opt/data/...`。后端受管根是 `/opt/data`，工作区在 `/opt/data/workspace`。
 *
 * 抽成纯函数是为了能被单测真实 import —— 此前这段逻辑在测试里被复制了一份，
 * 改坏生产代码测试依然全绿。
 */

export const MANAGED_ROOT = '/opt/data'
export const WORKSPACE_ROOT = '/opt/data/workspace'

export function normalizeManagedPath(rawPath: string): string {
  if (!rawPath) return ''

  let p = rawPath
    .replace(/^sandbox:\/?\/?/, '')
    .replace(/^\.\//, '')
    .trim()

  // 以 / 开头但不是受管根：把根斜杠剥掉，当成工作区内的相对路径
  if (p.startsWith('/') && !p.startsWith(`${MANAGED_ROOT}/`)) {
    p = p.replace(/^\//, '')
  }

  if (p.startsWith(`${MANAGED_ROOT}/`)) return p
  if (p.startsWith('workspace/')) return `${MANAGED_ROOT}/${p}`
  return `${WORKSPACE_ROOT}/${p}`
}

/** 规范化后的路径是否仍落在受管根之内。 */
export function isManagedPath(normalized: string): boolean {
  return normalized.startsWith(MANAGED_ROOT)
}
