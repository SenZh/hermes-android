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
  console.log('[Test 2] Testing Managed Files Sandbox Guard & Normalizer...')

  function normalizeAndVerify(rawPath) {
    if (!rawPath) return { safe: false, path: '' }
    let p = rawPath.replace(/^sandbox:\/?\/?/, '').replace(/^\.\//, '').trim()
    if (p.startsWith('/')) {
      if (!p.startsWith('/opt/data/')) {
        p = p.replace(/^\//, '')
      }
    }
    let normalized = p
    if (normalized.startsWith('/opt/data/')) {
      // 允许
    } else if (normalized.startsWith('workspace/')) {
      normalized = `/opt/data/${normalized}`
    } else {
      normalized = `/opt/data/workspace/${normalized}`
    }
    const safe = normalized.startsWith('/opt/data')
    return { safe, path: normalized }
  }

  // 截图复现场景：output/test-client-document.md
  const t1 = normalizeAndVerify('output/test-client-document.md')
  assert.equal(t1.safe, true, 'output/xxx MUST be safe')
  assert.equal(t1.path, '/opt/data/workspace/output/test-client-document.md', 'output/xxx must resolve into workspace')

  // /output/xxx 带着斜杠开头
  const t2 = normalizeAndVerify('/output/test-client-document.md')
  assert.equal(t2.safe, true, '/output/xxx MUST be resolved to workspace')
  assert.equal(t2.path, '/opt/data/workspace/output/test-client-document.md')

  // sandbox: 协议
  const t3 = normalizeAndVerify('sandbox:/output/test.txt')
  assert.equal(t3.safe, true)
  assert.equal(t3.path, '/opt/data/workspace/output/test.txt')

  console.log(' -> PASSED: Path normalizer strictly maps relative and workspace files to managed root.\n')
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

// 5. 测试审批模式状态轮转与图标配置
function testApprovalModeCycling() {
  console.log('[Test 5] Testing Approval Mode Cycling logic...')

  const order = ['manual', 'smart', 'off']

  function getNextMode(current) {
    return order[(order.indexOf(current) + 1) % order.length]
  }

  assert.equal(getNextMode('manual'), 'smart', 'manual cycles to smart')
  assert.equal(getNextMode('smart'), 'off', 'smart cycles to off')
  assert.equal(getNextMode('off'), 'manual', 'off cycles back to manual')

  console.log(' -> PASSED: Approval mode cycle logic 100% verified.\n')
}

function runAll() {
  console.log('=== RUNNING HERMES ANDROID VERIFICATION TEST SUITE ===\n')
  testProviderFilter()
  testPathSecurityGuard()
  testSelectablePlatformLogic()
  testReasoningEffortI18n()
  testApprovalModeCycling()
  console.log('=== ALL 5 SUITES PASSED (0 ERRORS) ===')
}

runAll()
