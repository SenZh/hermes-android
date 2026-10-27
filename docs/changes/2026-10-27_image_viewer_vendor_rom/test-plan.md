# 测试计划：图片手势查看器 + 国产 ROM 文件打开适配

日期：2026-10-27

## 分层

| 层 | 手段 | 覆盖什么 | 局限 |
|----|------|---------|------|
| L1 | vitest 纯函数单测（真实 import） | `imageZoom.ts` 全部决策逻辑；`inferMimeType`；`downloadManager` 既有函数 | 不覆盖手势真实响应 |
| L2 | `scripts/verify-fixes.mjs` 源码静态断言 | 组件必须接手势、必须走纯函数、Kotlin 必须走四层降级、五家厂商映射齐全 | 文本断言可被绕过（历史已发生过），只能防回退不能证明正确 |
| L3 | 真机 | 捏合手感、全屏覆盖、APK 安装器、文件管理器跳转 | 只能人工，无自动化 |

## L1 用例清单

### imageZoom（TC-ZOOM-01 ~ 11）

| ID | 断言 |
|----|------|
| 01 | 正常倍率透传；超上限夹到 5 |
| 02 | 捏合过程允许 0.8；低于 0.7 夹到 0.7 |
| 03 | NaN → 1；+Infinity → 5；-Infinity → 0.7 |
| 04 | 仅 <1 才回弹 |
| 05 | 1x 单击 → fullscreen |
| 06 | >1 单击 → reset |
| 07 | 1.0000001 不被误判为放大 |
| 08 | 双击 1 ↔ 2.5 |
| 09 | 未放大不允许平移 |
| 10 | 放大后按溢出量夹取 |
| 11 | 内容小于容器锁 0 |

### inferMimeType（TC-DL-23 ~ 24）

| ID | 断言 |
|----|------|
| 23 | `.apk` / `.APK` → package-archive；服务端给 octet-stream 时按扩展名纠正 |
| 24 | pdf/zip/png 归类正确；服务器给合法自定义类型时保留；未知扩展名 → `*/*` |

## L2 断言清单

- Test 24：openFolder 四层降级齐全（MIME_TYPE_DIR / documentsui / 厂商包名 / OPEN_DOCUMENT_TREE）；厂商组件必须 `resolveActivity` 探测；自启动映射覆盖五家；manifest 声明电池优化权限；about 页有入口
- Test 25：图片必须走 `ZoomableImage` 而非裸 `Image`；Pinch/Pan/Tap 齐全；必须 `Gesture.Exclusive(doubleTap, singleTap)`；必须 `runOnJS`；五个纯函数必须被组件调用

## L3 人工清单

1. 打开 4K PNG → 双指放大到 3x 以上 → 拖动到四角 → 缩小回 1x 松手是否回弹
2. 1x 单击 → 是否全屏且黑底覆盖完整 → 再单击是否退出
3. 放大状态单击 → 是否复位而非退出全屏
4. 已下载的 APK 点「打开文件」→ 是否进系统安装器
5. 点「打开所在目录」→ 是否落文件管理器、是否弹 Google
6. 关于页 → 电池优化状态是否真实 → 点自启动是否能跳到厂商页面

## 已知未覆盖

- 手势回弹的动画曲线与手感，无法自动化
- 小米/华为等真机的自启动页面组件名是否仍然有效
- 全屏层在 SafeArea / 刘海屏下的覆盖情况
