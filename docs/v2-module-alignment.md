# dev/v2 四模块接口对齐验收

此为 #1050 合并前的历史验收。Storage/Application 合入后的当前结果见 [六模块衔接审计](v2-six-module-alignment.md)。

本次基于 `origin/dev/v2` 的 `662746d4d51216acb687b1bdbe95c3dd689a9db1`，仅修复已迁移的 L1、L2、AST、L4 及其测试接缝。Application / Sync / UI 的整体迁移继续由对应模块负责。PR 目标为 `dev/v2`，不启用自动合并。

## 设计契约与修复

| 接缝 | 当前约定与验证 |
| --- | --- |
| L1 → L2 | Parser 返回 `SourceConversationParseResult`，Index/Detail 均无 key。Provider 等待 `ingestIndexes(accountId, [{conversationId, fields}], page?)` / `ingestDetail(accountId, conversationId, detail, indexFields?)` 完成，返回 void；L2 绑定 key。历史测试夹具显式绑定 Account，不恢复已删除的生产 Parser 结果类型。 |
| L2 → AST | 读取已提交的 Account、Index、Detail；Index-only 不产生虚构正文。`withConversationMetadata` 后直接调用 `composeDomainDocument`，返回 `DocumentAst`，没有 `.document` 包装及空 diagnostics。修正原先读取旧返回值的测试及 corpus 编译器。 |
| AST → L4 | MD / HTML / Typst 使用相同 AST，资源路径来自 Packaging 的 `ResourceBindings` 类型。JSON 直接序列化可信 Domain + Account。架构检查允许这两项设计依赖，继续阻止 Parser、网络、Storage 等非法依赖和运行时 bindings 导入。 |
| 资源侧通道 | task 创建并释放 `SourceResourceContext`；资源按完整 ConversationKey 隔离。字节不写入 Domain / AST。新回归实测获取字节、规划路径、渲染、ZIP 文件及字节一致性。 |

参考：[L1](https://app.notion.com/p/3fb5d4d759e1812f9962cf24dcf9116a)、[L1 → L2](https://app.notion.com/p/3fc5d4d759e181bb9df1d848d3c270b1)、[L2](https://app.notion.com/p/3fb5d4d759e1814aaa92ee02a21419a7)、[Composer](https://app.notion.com/p/3fb5d4d759e181928f01c3403e9ea6c3)、[L4](https://app.notion.com/p/3fc5d4d759e1813f9483eebd058f7066)。

另外拆分了纯标题、错误文本和 dev-mode 工具，避免 Parser / Format 通过工具聚合入口依赖旧 Application/UI 类型。Storage broker 使用独立的版本常量，线协议仍为 3。修复无标题且无 URL 的引用：AST 仍保留空标签与独立编号，Format 显示一次编号，不生成空 Markdown 链接或多余尾部空格。

## 可复现的专项门禁

```sh
npm run test:v2-modules
node scripts/typecheck-v2-modules.cjs
```

入口依次运行 L1 manifest、L4 manifest、L2/AST/跨模块 manifest 及类型检查。`tests/v2-module-tests.json` 明确记录完整文件和混合文件中的选定测试；运行器拒绝匹配不到测试的组。不同 manifest 可以重叠，执行次数不能解释为独立测试数。

L1 类型脚本此前未包含运行时测试清单，本次补入所有 suite / selected 文件。四模块类型检查基于整个项目的 TypeScript 程序，仅将明确归属的源码、夹具及清单测试诊断作为迁移门禁，另外打印相邻模块诊断数；不使用 `skip`、`@ts-ignore` 或恢复 v1 生产别名来宣称整仓类型通过。L4 tsconfig 也已扩展到所有 L4 清单文件。

2026-10-17 最终验收：

| 检查 | 结果 |
| --- | --- |
| 四模块专项门禁 | **1110 次测试执行通过，0 失败**，含重复覆盖：L1 520、L4 347、L2/AST/跨模块及测试归档 243。含真实离线 Typst WASM 编译。 |
| 四模块类型检查 | **0 个模块归属诊断**；明确排除 235 个相邻诊断。L1 独立脚本为 0 个归属诊断、30 个相邻诊断。 |
| 全仓 TypeScript | 235 个诊断：src 65、tests 170；基线为 317 个。 |
| 全部 Node 单测逐文件执行 | 290 个文件：218 通过、72 失败；1649 项测试通过、136 项失败。相比基线修复 63 个失败文件，原先通过的文件无回退。 |
| 新纯工具与改动渲染/传输文件的 scoped no-explicit-any lint | 通过。 |
| `git diff --check` | 通过。 |

`conversation_index_storage` 的 8 个现有测试通过，剩余失败依赖尚未迁移的 Sync `markConfirmedDeleted`；`provider-native-callers`、`pdf_domain_direct`、`trusted_domain_export` 仍加载已删除的 Application/PDF 流水线。其纯模块行为由清单中的独立测试覆盖，未将这些混合文件标记为全通过。

## 尚未完成的全仓集成

- `npm test` 已实际执行；现停在 `nativeDetailTransport.ts` 和 `background/batchFetcher.ts` 的旧 Application 类型造成的 unsafe-assignment 门禁。zero-any 清单中已经删除的路径已移除，并加入迁移后的路径和新纯工具；未放宽现存文件检查。
- 全仓 TypeScript 仍失败，包括旧 Content / Sync 调用签名、Application 传输类型、旧 PDF/导出入口及对应混合测试。专项脚本显式计数这些相邻诊断。
- `node build.js` 仍有 4 个缺失入口：`chatFormatter` 的 `exportDomainDocument` / `jsonFormatter`，`exportOrchestrator` 的 `planExportResources`，UI `exportController` 的 `pdfExporter`。这些调用方需要继续迁移，不重建已删除的实现。
- `python3 tests/run_tests.py` 在运行 Node 测试前，被旧 `geminiClient` 中 500 条计数 / `hitGoogleLimit` 的源码字符串断言阻断。现有 L1 的历史窗口限制行为由 Provider/ListEnd 体系测试覆盖；没有将源码断言改成无条件通过。
- 另逐文件独立执行了全部 Node 单测，以免上述提前失败掩盖测试 gap。剩余失败包含旧 Application 导出流水线、Sync 删除状态、UI 及混合测试，不能据此声称全仓测试或端到端通过。未执行依赖完整应用 build 的 Tier 2 / Tier 3。

场景池检查为 20 / 20，本轮不消费在线场景。
