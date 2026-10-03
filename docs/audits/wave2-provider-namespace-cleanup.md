# W2-07 Provider namespace recheck and #770 nullable dependency fix

Baseline: `7830514` (#770). The requested local fix adds `| null` to only
`MessageRouterDeps.storage` and `utils`. The existing detail contract suite now
contains the direct compile-time assignment:

```ts
const deps: MessageRouterDeps = { storage: null, utils: null };
```

The assignment uses no any, assertion, unchecked fixture or suppression. Removing
either nullable alternative makes strict type-check reject it. Router runtime
logic is unchanged, including the existing explicit-null dependency behavior.

## Exact namespace reference results

W2-03 already removed these four reexports. This task rechecked current main
instead of assuming the earlier audit remained accurate.

| Symbol | aiProvider.ts exports | provider/index.ts exports | Repository imports through either module | Action |
|---|---|---|---|---|
| Conversation | 0 | 0 | 0 | Already removed in W2-03; no further deletion |
| ChatMessage | 0 | 0 | 0 | Already removed in W2-03; no further deletion |
| Attachment | 0 | 0 | 0 | Already removed in W2-03; no further deletion |
| TitleSources | 0 | 0 | 0 | Already removed in W2-03; no further deletion |

The audit scanned all 426 tracked TS/JS-family code files using module-literal
search, including multiline imports/reexports, namespace forms, import types,
require and dynamic imports. Six direct references resolve to aiProvider.ts:

- `gemini/geminiContracts.ts`: AIProvider, ProviderReadiness.
- `providerRegistry.ts`: AIProvider.
- `providerResolver.ts`: AIProvider.
- `provider/index.ts`: export-star barrel.
- `src/types/detailTransport.ts`: ProviderConversationDetail.
- `tests/provider_contract.test.ts`: AIProvider, ProviderConversationDetail,
  ProviderConversationItem, ProviderMessage, ProviderPageResult, ProviderListOptions.

There are no external module references to provider/index.ts, and no occurrence
of the four domain symbols anywhere in `src/core/provider/`. Inspecting the
barrel's four exports confirms none of its reexported modules exposes these
names. Underlying domain definitions and their legitimate direct consumers
remain in `src/types/conversation.ts` / `src/types/index.ts`; historical audit
text mentioning the former reexports is not an active code consumer.

No symbol remains blocked by a real consumer. No duplicate cleanup, namespace
move, Provider redesign or consumer migration is needed. Barrel comments now
label neutral contracts/registry separately from the explicitly named Gemini
adapter/companion, without claiming the mixed barrel is entirely neutral.

## Retained architecture and changed files

`AIProvider.fetchAsset?` remains an optional, unverified Blob/ArrayBuffer seam,
with unknown options. Gemini still has no implementation and there is no
production AIProvider caller. AssetPipeline/PDF fetchAsset delegates are separate
contracts, not evidence for deleting or redesigning this seam.

Registry register/unregister/get/getAll/setDefaultProviderId/getDefault/findByUrl
remain intact and neutral. Resolver still imports Gemini for self-registration
and resolves URL first, default second. TabService preserves Gemini slot routing,
ChatGPT/Claude/DeepSeek URL mappings and unknown-pattern pass-through (including
future Grok URLs). Planned adapters are retained in CURRENT_ARCHITECTURE;
none is deleted or falsely reported implemented.

Changed files:

- `src/content/messageRouter.ts`: two nullable type alternatives only.
- `tests/messageRouter_liveSave_detail_contract.test.ts`: compile-time regression.
- `src/core/provider/index.ts`: comments clarifying export ownership.
- `CURRENT_ARCHITECTURE.md`: current namespace verification status.
- This audit report.

No production runtime behavior changes. Emission comparison against baseline
uses unmodified esbuild chrome120/ESM output with syntax/whitespace minification;
both changed production modules emit byte-identical JavaScript. Permanent
zero-any scope remains unchanged; W2-08 owns final integration. Tier 2/3 triggers
are untouched, and no live/visual pass is claimed.

| Check | Result |
|---|---|
| `npm run type-check` | Passed, including direct typed null assignment |
| `python3 tests/run_tests.py --filter provider` | 7 suites passed |
| Existing router null/deletion regressions | `seam_s1_content_router` passed |
| `CI=1 npm run test:changed` | 3 affected unit suites, strict types, build and 43 E2E passed |
| `CI=1 npm test` | Scoped zero-any, strict types, all 197 unit suite files, production build and 43 E2E passed without retries |
| `npm run pool:status` | 20/20; no scenarios consumed |
| Current tracked-code namespace audit | 426 files, 6 neutral-module references, zero targeted reexports/imports |
| Emission comparison | Both changed production modules byte-identical |
| `git diff --check` | Passed |

Audit script, exact reference output, emission comparison and validation logs are
retained in the core checkout's ignored `temp/w2-07-validation/` directory.
