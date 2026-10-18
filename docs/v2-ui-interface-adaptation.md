# dev/v2：保留现有页面的 UI 接口适配

日期：2026-10-17。基线：`25d72799`（#1051 合入后的 `dev/v2`）。PR 目标为 `dev/v2`，不启用自动合并。

## 范围与设计

依据 [Options](https://app.notion.com/p/3fc5d4d759e18121aaa3e78b699508b6)、[Popup](https://app.notion.com/p/3fc5d4d759e181768d99f9be31000518)、[Badge](https://app.notion.com/p/3fc5d4d759e18100a78bdc55a8b00b93)、[Guidance](https://app.notion.com/p/3fc5d4d759e1812e9d46ceb51378dc46) 与 [Settings](https://app.notion.com/p/3fb5d4d759e181a093f4d0fe991fc834) 的当前契约。

HTML、CSS、页面布局、现有按钮和 Controller 分工保持不变。删除失效的旧引擎、StorageService 对象、FormatStore、LiveStorageManager 和持久化任务恢复调用，直接接入已迁移模块；没有增加 Manager、全局事件总线、持久化任务 Schema 或兼容存储层。

| 功能 | 接入方式及边界 |
| --- | --- |
| 会话列表、记录、诊断 | Storage 的 `listIndexes` / `listExportRecords` / `getIndex`；列表按 Index 活动时间排序，ID 保持不透明，账号切换清空视图和选择，延迟读取不覆盖新账号 |
| Options 导出 | Controller → Application `runExport`；格式、ZIP、资源开关、skip 偏好作为请求输入；Application 负责 AST、资源、交付和 Record；UI 只显示实际结果并重新读取记录 |
| Popup 导出 | 点击时重新读取活动标签绑定，`skipUnchanged:false`；使用同一导出链路；PDF 保留原有“前往工作台”提示；关闭 Popup 发送本次调用的 AbortSignal |
| 同步 | Options 直接调用 Application `scanAll`；展示已提交页数和会话数；只有 `partial_limit + provider_limit` 能触发 Takeout 建议，`max_pages`、HTTP429 和取消分别处理 |
| 取消、partial | 只取消本次调用，等待 Application 清理完成再解锁；资源 partial 单独提示并保留选择；不伪造成功或写导出记录 |
| 本地清理 | Application 的三个清理用例；异步操作捕获账号，写入失败不会先移除视图 |
| Takeout | 现有 Controller → `importTakeout`，使用真实 `{imported,status}`；只有实际导入大于 0 才写完成标记；不虚构媒体数量 |
| 设置与目录 | 单一 Settings Schema 和稀疏 key；目录句柄只读写专用 IDB Store；格式不支持、目录失效、取消选择都不抹掉 `enabledDisk` 意图 |
| 指引和 Badge | `tourAutoHandled` 对齐当前设计，第一步实际显示后写入；结束手动 Tour 不推进功能版本；目录建议仅影响当次导出；Badge 仅真实拖动结束写 Settings，不再读写网页 localStorage |

Runtime 仅补充 `getAccountContext` 的 `conversationId` 返回值，让 Popup 使用标签侧绑定的 ID，而不自行改写 ID。其余旧 Runtime 管线不在本轮迁移范围。

新 Index 没有云端删除状态事实，所以旧归档提示卡隐藏，不能靠列表缺失推断云端删除；普通本地清理仍可用。旧持久化 ExportSession 恢复条移除行为，保留当页失败项重试。评分触发策略和完整 Runtime/Live Save 执行链尚未在本轮宣称完成。

## 验证

- `npm run test:ui-v2`：通过。UI 及直接适配辅助代码、5 个更新的单元测试文件共 **0 个范围内类型错误**；Options、Popup、Badge 独立 bundle 通过；**29 个单元测试 + 10 个 Chromium 回归场景通过**。全仓仍有 **371 个范围外类型诊断**，这个命令不代表全仓类型检查通过。
- 浏览器场景使用实际页面 HTML、IndexedDB、L2、Application、AST、Markdown/HTML/JSON renderer 和浏览器下载；仅 Chrome 扩展宿主 API 与测试 Provider 的源端 IO 受控。实际下载 ZIP 并解压检查正文和持久化 Record；另外验证 partial、取消锁、账号切换、目录选择后的账号漂移、Takeout 导入、指引互斥及 Badge 拖动。
- PDF 的公共链路继续由既有 L4/Application 测试验证；本轮没有宣称完成现场 PDF 字体权限或 Live Gemini 实跑。
- `npm run test:v2-modules`：**1176 次测试执行通过**（各 manifest 有重叠），已迁移六模块的范围内类型检查通过。
- 296 个现有 TypeScript 测试文件逐文件运行：**181 个通过 / 115 个失败，1499 个测试通过 / 226 个失败**。相对上轮快照，没有原本通过的测试文件新增失败。旧 Runtime 和旧 UI 契约的历史测试仍有待迁移，不能将新 UI 范围门禁解释为所有历史 UI 测试通过。
- `npm test` 已执行，仍在现有 `nativeDetailTransport.ts:57/58/71`、`background/batchFetcher.ts:103` 的 error-typed unsafe assignment lint 处阻塞，未进入后续全仓门禁。
- `node build.js` 已执行，仍有 **17 个旧 Runtime 链接错误**，包括 `schemaMigration`、旧 Domain transport/store 等已删除依赖。UI 三个入口单独链接通过，不代表完整扩展可安装验收。
- 场景池检查 **20/20**；`git diff --check` 通过。本轮没有执行 Tier 2 / Tier 3。
