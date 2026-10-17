# dev/v2：Storage / Application 合入后的六模块衔接审计

日期：2026-10-17。基线：`7462b5da2e2657a18d00be3349e229f6e97e45a4`。

上一轮 PR [#1050](https://github.com/OTLFrostA/gemini-exporter/pull/1050) 已按用户指令 squash merge 到 `dev/v2`。合并时保留 Storage 已删除旧 `nativePersistence.ts` / `transport.ts` 的结果，没有恢复旧持久化层。本轮修复基于合并后的 `dev/v2`，新 PR 同样以 `dev/v2` 为目标，不启用自动合并。

## 设计依据

- [Storage 公共契约](https://app.notion.com/p/3fb5d4d759e1816dbc65c1cd23854e00) 与 [物理布局规范](https://app.notion.com/p/3fc5d4d759e1813297a3e34a874c60e4)：单 IDB、六个 Store、被动读写、原始 Detail、原子身份插入；不恢复旧迁移、资源缓存、数组存储或事务业务端口。
- [Application 公共设计](https://app.notion.com/p/3fb5d4d759e181169ed3dfed880a093a)、[Sync](https://app.notion.com/p/3fb5d4d759e181a599bdc88c5649b7a6)、[Export](https://app.notion.com/p/3fb5d4d759e181b78e79d5efa579c0af)、[Settings](https://app.notion.com/p/3fb5d4d759e181a093f4d0fe991fc834)。
- [L2](https://app.notion.com/p/3fb5d4d759e1814aaa92ee02a21419a7)、[Composer](https://app.notion.com/p/3fb5d4d759e181928f01c3403e9ea6c3)、[L4](https://app.notion.com/p/3fc5d4d759e1813f9483eebd058f7066)。

## 发现与修复

| 衔接 | 合入后的断点 | 本轮处理 |
| --- | --- | --- |
| L2 → Storage Account | `transactAccounts` 已删除；账户列表仍传 provider 参数 | L2 分配 UUID，调用 `insertAccountIfAbsent` 原子匹配，再按 L2 资料规则 `putAccount`；API 读取后过滤 provider |
| L2 → Storage Index/Detail | 仍依赖已删除的整账户数组、旧 Domain Store 和存储锁 | L2 逐 Key 读取并合并，仅批量提交本页已选择事实；Detail 在重新校验后参与完整性/版本选择 |
| L2 → Storage Coverage | 仍调用已删除的 `transactCoverage` | L2 串行读取、计算、被动 put；持久提交成功后才发布内存 CoverageSession，保持 Index 先于 Coverage |
| Storage → Application → AST/L4 | `getDetail` 原始值被当成 `TrustedDomainBody` | 新增 L2 `readConversation(key)`：验证 Index/Detail、引用闭合与请求身份，再返回可信 Domain；Export 仅消费该读取结果 |
| L1 Content → L2/Storage | 列表与 DOM 辅助入口导入旧存储；Provider Detail 调用仍期待返回 DTO | 接入 `listIndexes`、L2 读取；Provider 使用新 `(accountId, conversationId)` void 准入后重读契约 |
| 测试 → 六模块 | 旧 Chrome 数组键、资源缓存和迁移夹具无法加载新版 Storage | Node 测试使用生产 Storage + `fake-indexeddb` 测试后端；另保留真实 Chromium Storage 测试，新增双页面 Web Locks/IDB 检查及六模块导出整链测试 |

L2 的小型 admission lock 使用扩展 Origin 共享 Web Locks，非浏览器测试环境采用进程内 Promise 串行。它只保护事实读取/选择/提交，没有给 Storage 添加通用事务管理器。Settings 保持设计规定的稀疏浅合并，不增加锁或默认值写回。

新整链测试使用真实 Source Parser、GeminiProvider、L2、Storage、Application Scan/Export、Composer、Markdown、Packaging、ZIP、Browser Download 动作和 ExportRecord。网络/路由构造及 DOM 点击是受控测试边界；ZIP 的 Markdown 引用和 PNG bytes 实际解包核对。该测试的 IDB 后端为 `fake-indexeddb`，没有宣称它是真实浏览器或磁盘。真实 Chromium 测试另验证 Storage 事务失败/回滚、六表布局、账户清理及跨页面准入锁。

新增回归还覆盖：账户 UUID 唯一/资料更新/default、不同 provider 过滤、并发 Index 不丢失、完整 Detail 防止较旧 partial 覆盖、Index 提交后 Detail 失败、Coverage 提交失败与重试、损坏持久化图重新校验、任务资源 finally 释放、稀疏 Settings、选中清理保留 Coverage、账户全清保留身份。

旧的资源持久缓存、SchemaFrozen 迁移和资源 Broker 断言按新设计退役，不通过恢复旧接口让它们继续通过。现有快照选择、标题优先级、账户隔离、原始来源版本、引用闭合及渲染断言继续执行。混合测试文件的旧 Runtime 依赖移入对应测试体，选中的 L1 用例不再在加载阶段引入已删除的 AssetPipeline 依赖；全文件运行仍暴露待迁移用例。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run test:v2-modules` | **1,176 次执行通过，0 失败**；清单允许重叠，不代表唯一测试数量 |
| 其中 L1 / L4 | 520 / 347 次执行通过 |
| Storage + Application 原有测试 | 67 项通过 |
| 新增六模块整链 / Chromium 跨页面 | 3 / 1 项通过 |
| 六模块整程序类型检查 | **0 owned diagnostics**；409 条相邻未迁移代码/测试诊断明确报告，不隐藏为全仓通过 |
| 全量逐文件 Node 测试（不含 e2e，每文件 60s 上限） | 296 文件：180 通过、116 失败；1,482 项通过、207 项失败 |
| 同环境、同运行器的合并基线对照 | 294 文件：149 通过、145 失败；1,234 项通过、180 项失败。29 个原失败文件恢复，2 个新测试文件通过；**原通过文件新增失败为 0**。基线部分文件加载失败，修复加载后执行到更多旧测试，因此不能直接用失败测试项数推断回归 |
| `npm test` | **未通过**：先停在旧 Native Transport / BatchFetcher 的 4 条 error-typed unsafe-assignment lint；后续全量 unit/build/e2e 未由此命令执行 |
| 独立 `node build.js` | **未通过**：27 个链接错误，首先报告 Background 的旧 SchemaMigration / DomainStorage Broker 路径 |
| 场景池 | 20 / 20，本轮未消费 |
| Tier 2 / Tier 3 | 未执行；本轮没有更改来源解码、Takeout 解析算法或线上交互流程，未宣称完成整产品验收 |

全量逐文件扫描分别在本轮 worktree 和独立 detached 基线 worktree 执行。专项 gate 明确把 Storage/Application 目录、全部新套件及其 helper 纳入检查，原 L1/L2/AST/L4 套件继续运行。Zero-any 清单显式移除已退役文件，补入新 Storage/Application 文件，不在运行时跳过缺失路径。

## 留给后续迁移的接口

本轮六模块内部链接、类型及专项测试已对齐；完整扩展仍不能构建。待迁移项包括 Background 的旧 SchemaMigration/DomainStorage Broker、旧 BatchFetcher/Native Detail Envelope、UI 的 class-based Export/Live Save/session/旧 Settings 调用。Runtime 需要在扩展 Origin 执行新版 L1/L2/Storage/Application，建立薄 IPC 的调用/进度/取消路由。Content 中尚存的旧 UI 请求结果封装不能作为新版 Application 的数据入口，也不能在网页 Origin 自建第二份 Storage。后续应接入新版 void 准入和扩展侧重读流程。

本 PR 没有恢复旧 Broker、旧资源存储或旧导出引擎来掩盖这些错误，也没有修改主目录的分支或直接推送 main。
