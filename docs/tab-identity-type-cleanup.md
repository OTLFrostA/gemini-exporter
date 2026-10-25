# 标签页身份契约清理

基线：`769fa0f8`。范围：Runtime 的账号标签页路由、Content 发送者校验，以及
Claude/Grok 的现有读取器选页逻辑。

## 同一根因：检查过 ID，返回时却丢失证明

- `resolveAccountTab` 已跳过无 ID 的 tab 并验证 Provider/Account，但声明仍是
  `chrome.tabs.Tab`，下游只能用 `tab.id!`。新增 `AccountTab` 契约，仅把 id 收紧为
  number；成功返回时显式保留已验证 ID 和原标签页字段。`getAITab` 也使用该契约，
  删除从未返回过的 null 分支。失败仍抛错，匹配和优先级规则保持不变。
- `assertContentSender` 原来只返回 URL，忽略已经检查过的标签页 ID。现在返回
  `{ providerId, tabId }`。原 `requireContentAccount` 改名为 `requireContentContext`，
  返回经过现有校验的 account 和 tabId；主动操作直接使用此上下文。两个被动消费者
  只取 account，Registry 的 IPC 响应继续只返回原 Account 对象。
- Claude 的源读取/附件读取、Grok 的源读取先筛掉无 ID 的 tab，再在后续循环中断言
  ID 存在。现在直接投影为 number[]，保留活跃页优先及失败回退顺序。ID 为 0 不被误删。

手工确认五处类型证明丢失点：账号路由、发送者上下文、三个读取器的筛选结果。
六处下游非空断言自然消失。没有用 unknown 替换这些类型，也没有新增验证器。

新增一个具名接口；没有新增 helper、业务状态或条件分支。原校验函数改名并调整返回值，
消费者直接使用新契约，没有保留兼容包装。生产代码 +41/-31，净 +10 行；增加的行数
用于表达并保留已有校验结果，而非重做校验。没有改变网络请求、解析、授权或账号匹配规则。

## 同口径 AST 库存

只统计 `src/`；语法命中不直接等于债务数量。

| 类别 | 前 | 后 |
| --- | ---: | ---: |
| any | 0 | 0 |
| unknown | 522 | 522 |
| object | 8 | 8 |
| broad Record | 122 | 122 |
| 普通 as | 31 | 31 |
| 尖括号断言 | 0 | 0 |
| as const | 27 | 27 |
| 非空断言 | 25 | 19 |
| 无约束泛型 | 12 | 12 |
| 有约束泛型 | 23 | 23 |
| 运行时 typeof | 829 | 829 |
| 类型查询 typeof | 44 | 44 |

使用 skill 的 `audit-types.cjs`（roots=`src,tests,scripts`）和
`audit-type-flow.cjs`（roots=`src`），TS 5.9.3 侧车。语义候选计数前后一致，
工具没有把此次可选 ID 关系丢失列成候选，正确性依据是调用链审查、原生 TS7 检查
和负面类型测试。TS5 前后均有同一处既有 `credStorage.ts` 兼容诊断，不能当作 TS7 证明。

## 验证、合法边界与剩余问题

- 定向 Runtime/消息契约测试 56 项通过；Provider 定向测试 36 项通过。
- 新增类型用例：路由和发送者 ID 必为 number；原生可选 ID 的 Tab、缺失/undefined ID
  不能满足这些契约。既有消息传输类型测试更新为新的真实返回契约。
- 新增行为用例覆盖无 ID 的 tab、ID 为 0、活跃页优先、失效页回退、附件读取与缺失 ID
  在访问 Storage/注入脚本前失败；原有账号、授权撤销、文档定位及被动准入测试继续通过。
- 原 unsafe-flow 门禁新增 Content 发送者、Claude 附件和 Grok 源读取三个文件。
  `tabService` 已在既有门禁内。Claude 源读取器仍有独立的 JSON 数组元素隐式 any
  问题（`organizations.some`）；此次只修正选页契约，未将该文件宣称为 unsafe-flow 清零。
- IPC 响应、JSON 读取、catch 等真实外部边界保留原 unknown；未新增高风险例外。
- 完整 `npm test` 通过：370 个单元测试文件、生产构建、字体门禁；Playwright
  170 passed、1 个既有 skipped。
- 场景池 20/20。本次未改解析、Takeout、会话排序或网络拦截，未执行真实账号 Tier 2/3。
