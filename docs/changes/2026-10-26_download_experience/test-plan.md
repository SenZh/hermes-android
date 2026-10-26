# 测试方案与用例设计 (Test Plan) - v2 修正版

## 1. 测试策略
严格遵循 Handbook 铁律：**测试驱动，严禁循环自证，测试文件必须真实 `import` 生产代码模块**。

## 2. 自动化测试用例清单 (`tests/download.test.ts`)

| 用例 ID | 目标函数 / 场景 | 输入数据 | 期望断言 |
| :--- | :--- | :--- | :--- |
| **TC-DL-01** | `resolveFileNameConflict` 无冲突 | `app.apk`, `['other.txt', 'music.mp3']`, `rename` | 返回 `app.apk` 原名 |
| **TC-DL-02** | `resolveFileNameConflict` 冲突重命名 | `app.apk`, `['app.apk']`, `rename` | 返回 `app (1).apk` |
| **TC-DL-03** | `resolveFileNameConflict` 多重冲突递增 | `app.apk`, `['app.apk', 'app (1).apk']`, `rename` | 返回 `app (2).apk` |
| **TC-DL-04** | `resolveFileNameConflict` 冲突选择覆盖 | `app.apk`, `['app.apk']`, `overwrite` | 返回 `app.apk` 原名 |
| **TC-DL-05** | `calculateDownloadSpeed` 速度精确换算 | `prev=0, cur=1048576, elapsed=1000ms` | 输出 `1.0 MB/s` |
| **TC-DL-06** | `calculateDownloadSpeed` 小数据量单位换算 | `prev=0, cur=204800, elapsed=1000ms` | 输出 `200.0 KB/s` |
| **TC-DL-07** | `calculateDownloadSpeed` 极短时间与异常耗时保底 | `elapsed <= 0` 或 `cur < prev` | 输出 `0 KB/s` |
| **TC-DL-08** | `getDownloadStorageKey` 规范化 key | `/opt/data/workspace/output/test.apk` | 输出稳定唯一 key `hermes_dl_opt_data_workspace_output_test_apk` |
| **TC-DL-09** | `resolveFileNameConflict` 特殊字符与复杂后缀 | `report.final (v1).tar.gz`, `['report.final (v1).tar.gz']`, `rename` | 正确解析扩展名并输出 `report.final (v1) (1).tar.gz` |
| **TC-DL-10** | `safeParseDownloadRecord` 损坏脏数据容错 | `'invalid json {;;}'` 或 `null` | 返回 `null`，不抛未捕获异常 |
| **TC-DL-11** | `safeParseDownloadRecord` 完整字段校验 | 缺少 `targetUri` 或 `fileName` 的 JSON | 返回 `null`，防御不完整记录 |
| **TC-DL-12** | `safeParseDownloadRecord` 合法数据解析 | 标准 JSON 字符串 | 成功解析出对应对象，各字段类型准确 |

## 3. 回归防御断言 (`scripts/verify-fixes.mjs`)
- **[Test 21] 升级为真实 AST / 模块断言**：
  - 真实读取 `src/app/viewer.tsx` 源码，AST/正则双重断言：**绝对不包含 `.base64()` 调用**；
  - 真实 `import` `src/lib/downloadManager.ts` 运行覆盖与冲突断言，杜绝字面量静态伪自证。
