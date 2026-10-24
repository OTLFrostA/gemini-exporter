# L1 v2 migration

Source: [L1 module design](https://app.notion.com/p/3fb5d4d759e1812f9962cf24dcf9116a), including its Client, Sniffer, Parser and L1 → L2 child specifications.

## Implemented boundary

- `AIProvider` exposes `ListEnd`, committed-page progress, Detail submission completion, Readiness and `acquireResource(ConversationKey, asset, signal)`. The selected Account UUID is explicit. Provider cursor, slot and safety budgets stay inside L1.
- Gemini Client and Sniffer enter through `parseGeminiResponse`: transport framing is decoded once, RPC payloads are isolated by WRB ID and decoded payloads are shared within that acquisition. Detail may explicitly read companion LIST metadata, but cannot recover turns from another RPC. They also share list evidence normalization and `mergeConversationPages`. Client submits each page before its control callback. Sniffer never requests missing pages, verifies deletion or schedules Scan.
- HTTP 429 backoff cancellation in `GeminiAPIClient` propagates standard `AbortError` (`DOMException(..., 'AbortError')`) across both `getConversationList` and `fetchConversationPage`, whether triggered by a call-level or client-level `AbortSignal`.
- Source parsers output only `SourceConversationParseResult` (`conversationId` plus keyless L2 Index/Detail fields). Legacy public parser result contracts (`ConversationParseResult`, `ResourceConversationParseResult`, `ConversationAcquisitionFailure`, `NativeConversationInput`, `isResourceConversationParseResult`) have been removed from `src/l1/parsers/contracts.ts`, `src/l1/parsers/parsingResult.ts`, and `src/l1/parsers/index.ts`.
- Takeout ZIP IO and safety checks live in Import; HTML/activity parsing stays in pure Source Parsers. `importTakeout(file, accountId, onProgress, resources?)` returns only imported count/status and binds lazy ZIP readers without eager attachment decompression.
- DOM capture submits directly to L2. Storage transactions, title/detail selection, deletion policy, Scan state and UI badge updates are outside L1.
- ChatGPT uses the same neutral acquisition/submission API. Resource download availability does not determine body coverage quality.

## Deliberate approximation

Per the user's clarification, a parsed `BardErrorInfo 1096` on a non-head list request is treated as the history-window limit. This is a provider heuristic, not proof that remote history is exhausted. L1 commits the empty `provider_limit` terminal observation and returns `provider_limit`. First-request failures, HTTP 429, ordinary network failures and unknown Bard errors throw. There is no row-count test for “600”.

## Adjacent-module migration

Application and UI still require migration. L2 now exposes the designed keyless ingress. In particular:

- Sync must call the new list API and consume `onPageCommitted`/`ListEnd` instead of old batches, aggregate results and cursors.
- Detail callers must pass `(accountId, conversationId, signal)` and read accepted Domain afterward. Pure parser candidates are not export-ready `TrustedDomain`.
- Export must call `provider.acquireResource(key, asset, signal)` with the current full `ConversationKey`.
- Each acquisition/export task creates `createSourceResourceContext()`, shares it with its Provider (Gemini third constructor argument; ChatGPT `resources` dependency), Sniffer `init({resources})` and Import fourth argument, and calls `resources.release()` in `finally`. Providers never allocate a `ResourceContext`. Without explicit injection, including the registered Gemini singleton, they retain no inline resources and only acquire from locators.
- The legacy Takeout global `MediaIndex`/Conversation cache and its facade exports are removed. Import only submits facts to L2 and delegates source-bound ZIP readers to the injected task context; old consumers must read L2 and use task resource preparation.
- UI must call `importTakeout` and provide progress wording itself.
- Browser Runtime consumers must use required capture fields and optional Detail request context. Application receives deletion/stream signals through callbacks, without Sniffer fetching details.
- L1 directly awaits `ingestIndexes(accountId, [{conversationId, fields}], page?)` and `ingestDetail(accountId, conversationId, detail, indexFields?)`. L2 binds `ConversationKey`; source parsers never manufacture trusted keys.
- Adjacent modules still importing removed L1 contracts (`ConversationParseResult`, `ResourceConversationParseResult`, `MediaIndex`, `getAllConversations`) are intentionally left untouched for their module owners to migrate.

## L1 Tier 1 Test & Type-Check Audit

All L1-owned Tier 1 unit tests and compile-time contract checks are cataloged in `tests/l1-tier1.json` and executed via:

```sh
node scripts/test-l1.cjs
```

- **Full L1 test manifest (`tests/l1-tier1.json`)**: 519 unit tests across 50 pure L1 suites and 6 targeted L1 sub-suites pass (0 failures).
- **Scoped L1 TypeScript check (`scripts/typecheck-l1.cjs`)**: 0 diagnostics in L1 sources (`src/core/api/**`, `src/l1/client/**`, `src/l1/parsers/**`, `src/l1/imports/takeout/**`, `src/runtime/content/{messageBridge,geminiIndexCapture,hookCredentials}.ts`), L1 test suites, and compile-time boundary specs (`tests/domain_parsing.types.ts`, `tests/domain_trust.types.ts`). Adjacent diagnostics are explicitly excluded and counted; see [historical report](https://github.com/OTLFrostA/gemini-exporter/blob/7999e2ca7f9c4681e59c91eda8af3f5e5bc4a232/docs/v2-module-alignment.md) for the current run. The checker now includes every suite and selected test file in the L1 manifest.
- **Cross-layer / adjacent-module tests excluded from L1 manifest**: suites that test L2 Domain normalization/admission (`conversation_order`, `title_merge_characterization`, `domain_conversation_detail`, `domain_provider_parity`, `batch-b-normalization-boundary`, `timestamp_honesty`), L3 Document/Renderer composition, or L4 Export/Storage pipelines (`takeout-resource-lookup`, `takeout_transact`). Pure L1 cases that previously lived inside mixed Export/Application test files (`provider-native-callers`, `content-input-boundary`, `p0_regressions`, `user_file_attachment`, `regression_lock`) have been migrated into `tests/l1-native-acquisition.test.ts` and `tests/l1_extracted_regressions.test.ts`.
