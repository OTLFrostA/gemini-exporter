# L1 v2 migration

Source: [L1 module design](https://app.notion.com/p/3fb5d4d759e1812f9962cf24dcf9116a), including its Client, Sniffer, Parser and L1 → L2 child specifications.

## Implemented boundary

- `AIProvider` exposes ListEnd, committed-page progress, Detail submission completion, Readiness and resource bytes. The selected Account UUID is explicit. Provider cursor, slot and safety budgets stay inside L1.
- Gemini Client and Sniffer share RPC parsers, list evidence normalization and `mergeConversationPages`. Client submits each page before its control callback. Sniffer never requests missing pages, verifies deletion or schedules Scan.
- Source parsers output `conversationId` and keyless L2 Index/Detail fields. They no longer construct local UUID keys or brand results as TrustedDomain. L2 performs final validation and selection.
- Takeout ZIP IO and safety checks live in Import; HTML/activity parsing stays in pure Source Parsers. `importTakeout(file, accountId, onProgress)` returns only imported count/status. Resource handles remain transient acquisition context.
- DOM capture submits directly to L2. Storage transactions, title/detail selection, deletion policy, Scan state and UI badge updates are outside L1.
- ChatGPT uses the same neutral acquisition/submission API. Resource download availability does not determine body coverage quality.

## Deliberate approximation

Per the user's clarification, a parsed `BardErrorInfo 1096` on a non-head list request is treated as the history-window limit. This is a provider heuristic, not proof that remote history is exhausted. L1 commits the empty `provider_limit` terminal observation and returns `provider_limit`. First-request failures, HTTP 429, ordinary network failures and unknown Bard errors throw. There is no row-count test for “600”.

## Adjacent-module migration

Application, UI, L2 and Storage implementations were not changed. In particular:

- Sync must call the new list API and consume `onPageCommitted`/ListEnd instead of old batches, aggregate results and cursors.
- Detail callers must pass `(accountId, conversationId, signal)` and read accepted Domain afterward. Pure parser candidates are not export-ready TrustedDomain.
- Export must call `provider.acquireResource(key, asset, signal)` with the current full ConversationKey.
- Each acquisition/export task creates `createSourceResourceContext()`, shares it with its Provider (Gemini third constructor argument; ChatGPT `resources` dependency), Sniffer `init({resources})` and Import fourth argument, and calls `resources.release()` in `finally`. Provider exposes its per-instance `resources` for the same delegation. Inline base64/bytes and bound ZIP readers are transient and keyed by account/conversation/asset; missing current bytes fall back to source locators. Application must wire this task context; no global resource cache or persistent resource schema was added.
- UI must call `importTakeout` and provide progress wording itself.
- Browser Runtime consumers must use required capture fields and optional Detail request context. Application receives deletion/stream signals through callbacks, without Sniffer fetching details.
- The currently available L2 `ingestIndexes` still accepts keyed indexes and an options object. L1 keeps a mechanical account-key binding at its direct call sites to use that existing signature; normalization/selection/Coverage are not duplicated. This can disappear when L2 exposes its documented keyless ingress signature.
- Old Application compatibility types, old parser-to-export tests and legacy acquisition callers need their owners' migration. No compatibility pipeline was added to preserve those contracts.

## Validation

Only L1 Tier 1 tests were run:

```sh
node -r ./tests/ts_register.js --test tests/l1_contract.test.ts tests/provider_contract.test.ts tests/page_observation.test.ts tests/pagination_detail_dedupe.test.ts
```

47 tests pass. `git diff --check` passes. A scoped TypeScript check found no diagnostics in the changed L1 sources or new contract tests, but cannot pass overall because imported Application/UI dependencies still use removed APIs and some L4 imports are already missing on the base branch. Those files were left untouched. No full repository suite, Tier 2 or Tier 3 was run.
