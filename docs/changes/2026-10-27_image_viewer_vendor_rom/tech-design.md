# 技术方案：图片手势查看器 + 国产 ROM 文件打开适配

日期：2026-10-27

## 一、根因

### 1.1 图片无法缩放

`src/app/viewer.tsx` 原实现：

```tsx
<Image source={{ uri: q.data.data_url }} style={{ width: '100%', aspectRatio: 1 }} contentFit="contain" />
```

`expo-image` 的 `Image` 是纯展示组件，不响应任何手势。整条渲染链上没有任何 `GestureDetector` / `PinchGestureHandler`，所以捏合必然无效。这不是配置问题，是能力缺失。

### 1.2 openFile 报 scheme 错误

`expo-sharing` 的 `SharingModule.kt:94` 硬编码：

```kotlin
if ("file" != uri.scheme) throw InvalidArgumentException("Only local file URLs are supported...")
```

SAF 落盘得到的是 `content://`，必然抛错。

### 1.3 openFolder 弹 Google

原实现 `Linking.openURL(treeUri)` 等价于裸 `Intent(ACTION_VIEW)`，没有 `type`。系统在全局按 scheme 匹配，国产 ROM 上常被注册了通用 filter 的应用（Google、浏览器、网盘）抢走，触发跨应用授权弹窗。

## 二、方案论证（逐项证明可行性）

| 假设 | 求证方式 | 结论 |
|------|---------|------|
| 项目已有手势依赖，无需新增 | `package.json` 实读：`react-native-gesture-handler ~2.32.0`、`react-native-reanimated 4.5.1`、`react-native-worklets 0.10.1` | 成立 |
| reanimated 在本项目已可用 | `src/components/ui/Sheet.tsx:6` 已 `import Animated, { useSharedValue, useAnimatedStyle, withSpring }` | 成立 |
| 根节点有 GestureHandlerRootView | `src/app/_layout.tsx:61` | 成立 |
| MIME_TYPE_DIR 可定向文件管理器 | Android 文档：`DocumentsContract.Document.MIME_TYPE_DIR` = `vnd.android.document/directory`，DocumentsUI 声明了该类型 | 成立，但国产 ROM 可能替换 DocumentsUI，故需降级链 |
| 自启动可被程序开启 | 查阅 Android 开发者文档与厂商适配实践：无公开 API 可读写自启动开关，只能跳转 | **不成立**，方案改为「跳转引导」 |
| 电池优化豁免可用标准 API | `PowerManager.isIgnoringBatteryOptimizations` + `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | 成立，需声明 `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` |

## 三、设计

### 3.1 分层

```
UI 层   src/app/viewer.tsx            只做状态与页面装配
组件层  src/components/ZoomableImage  只做手势接线与 shared value 读写
逻辑层  src/lib/imageZoom.ts          纯函数：夹取、回弹判定、单击语义、平移边界
```

逻辑层的存在理由：手势回调跑在 UI 线程（worklet），不能调用普通 JS 函数做分支判断以外的复杂逻辑；把决策抽成纯函数后既能在 UI 线程安全调用，又能被 vitest 真实 import 覆盖。

### 3.2 手势组合

```
Gesture.Simultaneous(
  Gesture.Exclusive(doubleTap, singleTap),   // 单击必须让位于双击
  Gesture.Simultaneous(pinch, pan)
)
```

关键点：`Exclusive` 不可省。若不声明，`Gesture.Tap()` 的单击与双击会互相抢占，一次点击可能同时推进两个分支。

### 3.3 单击语义

`resolveSingleTap(scale)`：

- `scale ≈ 1` → `fullscreen`（进入/退出全屏）
- `scale > 1` → `reset`（复位到 1x）

理由：用户放大查看细节后，第一反应是点一下回到全貌；此时直接退出全屏是反直觉的。

### 3.4 缩放边界

- 捏合过程中 floor 取 `RUBBER_BAND_FLOOR = 0.7`，允许短暂小于 1x，避免手指略松就卡死
- 松手 `shouldSnapBack` 为真则 `withTiming(MIN_SCALE)`
- 上限 `MAX_SCALE = 5`

### 3.5 平移边界

`clampTranslation(value, containerSize, contentSize, scale)`：
溢出量 = `(contentSize × scale − containerSize) / 2`，溢出 ≤ 0 时锁 0。

已知近似：`contentSize` 传的是容器尺寸而非图片真实显示尺寸（contain 模式下图片可能比容器窄或矮）。因此对非等比图片，纵向可拖动范围会大于真实需要，可能导致图片被拖到顶部留白处。这是本轮接受的近似，记为已知限制。

### 3.6 openFile

```kotlin
Intent(ACTION_VIEW).apply {
  setDataAndType(uri, mime)
  addFlags(FLAG_GRANT_READ_URI_PERMISSION)
  addFlags(FLAG_ACTIVITY_NEW_TASK)
}
```

MIME 由 TS 侧 `inferMimeType(fileName, serverMime)` 推断，优先级：服务端给出的非 `octet-stream` 类型 > 扩展名表 > `*/*`。APK 必须落到 `application/vnd.android.package-archive` 才能唤起安装器。

### 3.7 openFolder 四层降级

1. 隐式 `ACTION_VIEW` + `MIME_TYPE_DIR`（排除浏览器/Google）
2. 显式 `com.android.documentsui.files.FilesActivity` + `EXTRA_INITIAL_URI`
3. 厂商文件管理器（先用 `resolveActivity` 探测，再启动）
4. `ACTION_OPEN_DOCUMENT_TREE` + `EXTRA_INITIAL_URI` 兜底

每层 `try { startActivity } catch { 下一层 }`，任一层成功即返回。

### 3.8 国产 ROM 保活引导

- 电池优化：可查询真实状态，可发起豁免请求
- 自启动：按 `Build.MANUFACTURER` 映射到五家厂商的 ComponentName，`resolveActivity` 探测失败则退到应用详情页

## 四、已知限制与风险

| 项 | 说明 |
|----|------|
| 手势未真机验证 | 本地无 Android SDK，只能靠 CI 编译 + 用户真机反馈 |
| 平移边界为近似 | 见 3.5 |
| 厂商组件名会漂移 | ROM 升级可能改 ComponentName，已用 resolveActivity 探测兜底 |
| 自启动状态读不到 | 无法显示「已开启/未开启」，只能提供入口 |
| 全屏层用绝对定位而非 Modal | 若 Screen 有 transform 或父级 overflow 限制，可能覆盖不全，待真机确认 |
