# CURRENT_ARCHITECTURE.md

> 本文档是仓库架构现状的唯一状态表。AI 审计 / 清理时**必须先读本文档**：
> multi-provider 相关代码是 near-term planned architecture，**不是 dead code**，
> 不得以"当前只有一个 production 实现"为由删除其中任何部分。

完整架构细节见 [docs/architecture.md](docs/architecture.md)。

## 平台状态表（2026-09-27）

| 平台 | 状态 | 说明 |
|---|---|---|
| Gemini (`gemini.google.com`) | **production** | 唯一生产支持的平台。`GeminiProvider` 为完整实现：batchexecute RPC、实时嗅探、多账号 slot、Takeout 导入。 |
| ChatGPT (`chatgpt.com`) | **planned — implementation incomplete/unverified, NOT production-ready** | `ChatGPTProvider` 为 dormant scaffold：已注册但 `listConversations` 直接抛错；manifest 无 `chatgpt.com` host permission / content-script 匹配，运行时不可达。`mapping`/`current_node` 归一化（`flattenChatGPTMapping`）有单测、无真实会话验证。 |
| Claude | **planned** | 无实现。`getAITab` 已预留 `https://claude.ai/*` 模式映射。 |
| Grok | **planned** | 无实现。`getAITab`/`sendToAITab` 对未知 providerId 按 URL pattern 直通，无需改代码即可路由。 |

## Provider 相关 symbol 边界（PR #— provider roadmap boundary audit）

Verdict 定义：
- `KEEP-contract`：四个平台都需要的中性契约，保留。
- `GEMINI-SPECIFIC-misnamed`：名字中性、实际只服务 Gemini 的，报告中标出（本 PR 不改名）。
- `SCAFFOLD-unverified`：为 planned provider 搭的架子、未经真实验证，代码内以 `// @unverified-provider-scaffold` 标记（可 grep）。
- `UNKNOWN`：拿不准的——本轮为 0，全部已分类。

### `src/core/provider/`（扩展 provider 层）

| Symbol | Verdict | 备注 |
|---|---|---|
| `AIProvider`（interface） | KEEP-contract | 中性生命周期：`checkReadiness` / `listConversations` / `fetchConversationDetail` / `matchesUrl` / `fetchAsset?`。被 `resolveProvider` 及 3 个 content 模块使用。 |
| `ProviderConversationItem` / `ProviderConversationDetail` / `ProviderPageResult<T>` / `ProviderCapabilities` / `ProviderReadiness` | KEEP-contract | 中性形状，index signature 允许平台扩展字段。 |
| `ProviderRegistry`（`register`/`unregister`/`get`/`getAll`/`findByUrl`/`getDefault`） | KEEP-contract | 通用注册表契约。`getAll()`/`unregister()` 是注册表应有 surface，不是死代码。 |
| `resolveProvider()` | KEEP-contract | `syncEngine` / `liveSaveCoordinator` / `messageRouter` 共用。 |
| `GeminiProvider` | KEEP（production 实现） | 命名诚实。`fetchConversationDetail` 把完整 Gemini detail spread 进中性返回——这是生产适配器的本职，声明返回类型保持中性。 |
| `ChatGPTProvider` | SCAFFOLD-unverified | 见上表。网络路径（`/api/auth/session`、`backend-api/conversation`）与 capability 声明（takeout/thoughts/incremental=true）均未用真实登录会话验证。 |
| `flattenChatGPTMapping` | SCAFFOLD-unverified | 有单测，无真实 payload 验证（分支选择、thought 编码可能与实际不符）。 |
| `defaultChatGPTProvider`（自注册） | SCAFFOLD-unverified | 保持注册表多 provider 形态，无害。 |
| `export type { Conversation, ChatMessage, Attachment, TitleSources }`（`aiProvider.ts` 重导出） | GEMINI-SPECIFIC-misnamed | 模块头注释自称 "Universal AI Provider specification"，实际重导出 Gemini pipeline 类型（`TitleSources` 含 `rpc`/`dom`/`takeout`/`sniff`；`Conversation` 含 `hitGoogleLimit`/`isTakeoutOnly`/`accountSlot`）。已核实：仓内 0 外部引用。本 PR 不动，仅标出。 |
| `getAITab` / `sendToAITab`（`tabService.ts`） | KEEP-contract | provider→tab 路由契约。当前无 production caller（仅测试）——这是 planned architecture 的预期状态，不是死代码。 |

### `scripts/framework/`（Python Tier-2/3 测试框架——与上独立的另一套概念）

| Symbol | Verdict | 备注 |
|---|---|---|
| `ChatPlatformDriver`（ABC）、`PlatformCapabilities`、`TurnResult`、`PlatformRegistry` | KEEP-contract | 平台中性 driver 契约；当前唯一实现是 Gemini，但 ABC 本身就是为 ChatGPT/Claude/Grok 预留的 seam。 |
| `FeatureTestCase` / `DAGRunner` / `TestContext` | KEEP-contract | 平台中性 scenario contract。 |
| `GeminiPlatformDriver` / `GeminiDriver` / `GeminiChatSession` | KEEP（production 测试实现） | 命名诚实。 |

### 已知非 verdict 的跟进点（不属本 PR scope）

- `syncEngine.ts` 注释承认 "the provider-neutral declared type is still stabilizing"，有一处 `as any` 绕过——待 provider 层稳定后收敛，不在本 PR 处理。
- `ProviderCapabilities.supportsRealtimeSniffing` 的术语源自 Gemini batchexecute 拦截机制；capability 概念本身通用，暂判 KEEP-contract，若未来平台语义分歧再议。
