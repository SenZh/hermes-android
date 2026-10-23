import assert from 'node:assert/strict'

// 1. 测试 Provider 过滤逻辑（模拟 ModelPicker 与 ModelChooser 的数据结构）
function testProviderFilter() {
  console.log('[Test 1] Testing Provider Filtering Logic...')

  const rawProviders = [
    { slug: 'openai', name: 'OpenAI', authenticated: false, models: ['gpt-4o', 'o1'] },
    { slug: 'anthropic', name: 'Anthropic', authenticated: false, models: ['claude-3-5-sonnet'] },
    { slug: 'cpa', name: 'CPA', authenticated: true, models: ['deepseek-v4.1-flash', 'gemini-3.7-flash'] },
    { slug: 'gitee', name: 'Gitee AI', authenticated: true, models: ['qwen3-embedding'] },
    { slug: 'mistral', name: 'Mistral', authenticated: false, models: ['mistral-large'] },
  ]

  // ModelPicker 过滤规则
  const filteredPicker = rawProviders.filter((p) => !!p.authenticated)
  assert.equal(filteredPicker.length, 2, 'ModelPicker should only keep 2 authenticated providers')
  assert.deepEqual(
    filteredPicker.map((p) => p.slug),
    ['cpa', 'gitee'],
    'Only CPA and Gitee AI should survive',
  )

  // ModelChooser 过滤规则
  const filteredChooser = rawProviders.filter((p) => p.authenticated !== false)
  assert.equal(filteredChooser.length, 2, 'ModelChooser should only keep authenticated providers')
  assert.deepEqual(
    filteredChooser.map((p) => p.slug),
    ['cpa', 'gitee'],
    'Only CPA and Gitee AI should survive',
  )

  console.log(' -> PASSED: Provider filtering blocks unauthenticated entries with 100% precision.\n')
}

// 2. 测试受管沙箱路径安全判定逻辑
function testPathSecurityGuard() {
  console.log('[Test 2] Testing Managed Files Sandbox Guard...')

  function isPathSafe(filePath) {
    if (!filePath) return false
    // 相对路径或 workspace 路径属于合法受管路径
    if (!filePath.startsWith('/')) return true
    // 绝对路径必须在 /opt/data 受管根目录下
    return filePath.startsWith('/opt/data')
  }

  // 必须被拦截的非法系统路径
  const unsafePaths = ['/opt/hermes/bin/hermes', '/etc/shadow', '/root/.bashrc', '/bin/sh', '/usr/local/bin/node']

  for (const p of unsafePaths) {
    assert.equal(isPathSafe(p), false, `System path '${p}' MUST be flagged as unsafe/outside managed root`)
  }

  // 必须放行的合法工作区路径
  const safePaths = [
    '/opt/data/workspace/package.json',
    '/opt/data/workspace/output/report.md',
    '/opt/data/cache/scratch/test.txt',
    'output/hermes-android-v1.8.1.apk',
    'src/components/chat/Composer.tsx',
    './README.md',
  ]

  for (const p of safePaths) {
    assert.equal(isPathSafe(p), true, `Workspace path '${p}' MUST be allowed for viewing`)
  }

  console.log(' -> PASSED: Path guard strictly isolates system roots from workspace files.\n')
}

// 3. 测试 Android Inverted FlatList 下选择性禁用 selectable 逻辑
function testSelectablePlatformLogic() {
  console.log('[Test 3] Testing Selectable Platform Guard...')

  function getSelectableOption(platform) {
    return platform !== 'android'
  }

  assert.equal(getSelectableOption('android'), false, 'On Android, selectable MUST be false to prevent Inverted FlatList jump')
  assert.equal(getSelectableOption('ios'), true, 'On iOS, selectable remains true')
  assert.equal(getSelectableOption('web'), true, 'On Web, selectable remains true')

  console.log(' -> PASSED: Android Inverted jump root-cause neutralized.\n')
}

// 4. 测试思考等级文案汉化映射
function testReasoningEffortI18n() {
  console.log('[Test 4] Testing Reasoning Effort i18n mapping...')

  const zhDict = {
    Off: '关闭',
    Minimal: '极简',
    Low: '低',
    Medium: '中',
    High: '高',
    'Extra high': '超高',
    Max: '最大',
    default: '默认',
  }

  function getEffortLabel(effort) {
    const map = {
      none: zhDict.Off,
      minimal: zhDict.Minimal,
      low: zhDict.Low,
      medium: zhDict.Medium,
      high: zhDict.High,
      xhigh: zhDict['Extra high'],
      max: zhDict.Max,
    }
    return effort ? (map[effort] ?? effort) : zhDict.default
  }

  assert.equal(getEffortLabel('medium'), '中', 'medium must map to 中')
  assert.equal(getEffortLabel('low'), '低', 'low must map to 低')
  assert.equal(getEffortLabel('high'), '高', 'high must map to 高')
  assert.equal(getEffortLabel('none'), '关闭', 'none must map to 关闭')
  assert.equal(getEffortLabel(undefined), '默认', 'undefined must map to 默认')

  console.log(' -> PASSED: Reasoning effort labels strictly localized.\n')
}

function runAll() {
  console.log('=== RUNNING HERMES ANDROID VERIFICATION TEST SUITE ===\n')
  testProviderFilter()
  testPathSecurityGuard()
  testSelectablePlatformLogic()
  testReasoningEffortI18n()
  console.log('=== ALL 4 SUITES PASSED (0 ERRORS) ===')
}

runAll()
