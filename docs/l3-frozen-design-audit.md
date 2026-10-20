# L3a / L3b 冻结设计审查

审查基线：`dev/v2` 的 `870fb0ec15ef61b4731342b6962981eea5102986`（含 #1064），2026-10-19 冻结设计。代码修复、测试迁移及本报告在独立分支 `codex/l3-design-contract-audit` 中完成。

## 权威设计

- [L3a Storage](https://app.notion.com/p/3fb5d4d759e1816dbc65c1cd23854e00)
- [Storage 物理布局](https://app.notion.com/p/3fc5d4d759e1813297a3e34a874c60e4)
- [v1 → v2 一次性迁移](https://app.notion.com/p/3fb5d4d759e18186b2eaf4041d711b92)
- [L3b Document AST](https://app.notion.com/p/3fb5d4d759e181ed9ea7cffc849a5769)
- [Document Model](https://app.notion.com/p/3fb5d4d759e1811eb7f0e665e59c5249)
- [Composer](https://app.notion.com/p/3fb5d4d759e181928f01c3403e9ea6c3)

以这些文档定义的新契约为准；没有为旧测试恢复兼容接口，也没有改写设计文档。

## 发现与修复

| 边界 | 原有偏差 | 修复及回归证据 |
| --- | --- | --- |
| L3b Disclosure | `title` 可选；Renderer 决定缺省标题和语言；空 `reasoning: []` 创建空卡片 | title 改为必填；Composer 使用唯一固定文案；三种 Renderer 直接消费 title；空数组不创建 Disclosure；增加类型负例及行为回归 |
| L3b Citation | 显式数字标签（如 `[99]`）会被重写成展示编号 | 非空来源标签完整保留，只有缺失标签才取 `[number]`；Sources 仍按 Citation 数组顺序全对话编号，ID 仍属于所在 Message |
| L3b 标题与资源文案 | Composer 删除来源标题中的换行；保留一套猜测“有意义文件名”的旧 helper；alt/label 缺省散落 | 标题、来源 alt/label/name 原样保留；删除文件名猜测；固定标题、Reasoning、Image/File 缺省在一个位置维护；不从 alt 自动生成 Caption |
| L2 → L3b 时间 | L2 接纳有限小数和不安全整数，不能保证 AST 的安全整数 Unix-ms 契约 | Index.createdAt/updatedAt 及 Message.timestamp 在 L2 接纳时校验安全整数；Composer 保持直接投影；覆盖小数、溢出、NaN/Infinity、epoch 0 |
| Migration → L3a | 完成标记放在普通 Storage 模块；Index 时间未转换；ExportRecord 可接受非整数且丢弃 epoch 0 | 标记归独立 Migration，仍最后写入；迁移已知毫秒数值/数值字符串及带时区的 ISO；无时区/无法解释/非整数时间按既定失败规则处理；不猜秒单位、不补当前时间；失败可重试 |
| Tier 1 Storage | 仍断言旧槽位、全局 schema 冻结、内存句柄/bytes、Storage 负责业务合并和导出 finalize | 迁移到实际 IDB 事务、复合键、22 个公开 IO 端口、Settings 原生锁、Runtime readiness、五类升级；保留回滚、并发、隔离、重试及原源保留覆盖 |
| Tier 1 AST | 仍断言消息展示 ID、Sources wrapper、单元格 align、附件额外去重、locale 决定 Reasoning、alt 衍生 Caption | 将相关单测、类型测试、视觉/parity JSON 及生成器迁移到直接 AST、来源位置和字段；保留实际 HTML/Markdown/Typst/PDF 验证 |
| Tier 2 导出 | 缺少当前 L3a 物理 schema 和 L2/Account → Composer 的接口验收 | 在真实导出后检查六 Store 的 keyPath/唯一索引、匹配的 ConversationKey/Account、AST metadata/消息事实/来源编号和标签、Reasoning 及资源查询闭合；不替代原有磁盘 ZIP/内容/图片验收 |
| Tier 2 升级 | 仍要求迁移旧正文和字节缓存，加载已删除的旧 Parser，并允许 NA 计成功 | 改成五类数据 oracle，要求完成标记、空 Detail/Coverage、旧源未改；没有 UUID Registry 的旧 profile 明确失败，不宣称支持槽位兼容或离线恢复 |

## 确认符合设计的核心接口

- Storage 公开面严格为 22 个函数，不再存在默认 `StorageService` 对象、旧 setter/finalize、缓存、凭据或全局 Schema Manager。
- 单一 `gemini_exporter_v2` IDB/version 1、六 Store，只有 `accounts.providerIdentity` 唯一二级索引；Account 范围查询使用复合主键区间。
- Index/Detail 的读取、同步决策及写入在原生事务中完成；异常回滚、提交完成后返回；删除只操作同一个 Key 的 Index/Detail/ExportRecord，不删除 Coverage。
- Scan reset 原子清理当前 Account 的 Coverage 与 ExportRecord；保留 Account/Index/Detail/Settings/Handle 及其他账户。
- Settings 只保存原始 Partial，不填默认值；唯一原生 Web Lock 保护浅 Patch；false 保留；权限和有效配置不持久化。DirectoryHandle 使用共享 IDB 的 `default` 单例，无内存 fallback。
- 普通 Storage 不读取旧源、不等待 Migration，只以类型依赖 L2/Application。Background readiness 负责初始化单飞、成功复用、失败重试。
- Composer 只有 `ReadonlyDomain + Readonly<Account> → DocumentAst`；按 Reasoning → Content → 显式附件排列，不推断归属或额外去重；不展开 document.contentMarkdown，不生成未归属 Asset 的阅读内容。
- Table 在表头/正文的连续网格中计算位置和跨度，恢复分组；columnAlignments 长度取逻辑列/声明列的最大值。增加跨表头 rowSpan 和空行回归。
- `collectDocumentResources(DocumentAst)` 返回本次新 Set，递归包含表格、Caption、Description、Disclosure 和富文本；无 Domain/Storage/资源下载副作用。

## 测试范围与未完成的其他模块

`tests/l3a-tier1.json` 和 `tests/l3b-tier1.json` 明确列出本轮所有者测试；运行 `node scripts/test-l3.cjs` 执行两组单元/集成、生产代码与对应测试的类型检查，以及 Tier 2 harness 离线回归。这是补充入口，全仓测试发现和 CI 门禁未缩小、未改为这个命令。

原混合测试中仍属于 Application/Export/Runtime 的旧场景保存在以下文件，继续由正常全量发现执行，仍有失败，不计入 L3 通过结论：

- `conversation-representation-other-layers.test.ts`
- `document-model-other-layers.test.ts`
- `html-document-migration-other-layers.test.ts`
- `live_storage_manager_other_layers.test.ts`
- `storage_export_surface_other_layers.test.ts`

`audit_reinforcement.test.ts` 与 `data_safety_batch1.test.ts` 仅迁移 L3/接纳边界的场景；它们的其他所有者场景原样保留。没有 skip/todo、删除测试发现、放宽类型门禁或恢复旧生产 API。

当前固定的 official v1.7.0 profile harness 不应被当成已证明符合 UUID v1 源前提的升级证据；它会先从真实旧磁盘检查前提，遇到槽位型源明确失败。必须另行取得满足冻结前提的真实 v1 profile，才能完成五类升级实测。本轮没有运行真实 profile 升级或 live Tier 2。

## 验证结果

- L3a：113/113；L3b：294/294；两组类型检查通过，零跳过。两组包含共享集成测试，数字不代表互斥覆盖。
- Tier 2 harness 离线回归：7/7（含错误 schema、身份、标签、Reasoning、引用集合与升级结果的负例）；probe 已纳入类型检查。连同已有 Tier 2 assertions 回归共 95/95 通过。
- L1 回归：613/613；L2 回归：289/289；对应类型检查通过，零跳过。
- scoped zero-any、生产构建通过。Storage 测试包含无头 Chromium 的真实 IDB 及原生 DirectoryHandle 重载验证；PDF model 测试使用真实 WASM 编译并提取 PDF 文本。
- 全仓 `npm test` 仍停在其他模块测试的 211 条 TypeScript 错误，生产 `src/` 无错误。全量 Node 单元发现为 1,783 通过、193 失败、6 取消、零跳过；未把它宣称为通过。
- 独立尝试 MiTeX 浏览器用例失败于旧 `window.__mitex` hook 缺失；仅修复其 Composer 直接返回接口，没有将该用例宣称通过。
- 场景池 20/20，本轮未消费。**未运行 live Tier 2。**
