# W2-02 Gemini pagination / completeness contract

Final integration supersedes the retained pagination/input typing debts in this
historical report; see [W2-08 closeout](wave2-integration-closeout.md).

Baseline: `05c37d3` (W2-01 / #764). This is a type-only control-plane change.
Provider contracts, sync/reconciliation, title precedence, storage schema and
W1 P-01–P-05 remain unchanged. No permanent lint gate is expanded.

## Authoritative upstream contract for W2-03

Use `src/core/api/client/pagination.ts` as the authoritative Gemini boundary.
`geminiClient.ts` reexports the result/options/callback/diagnostic types and
its public methods now preserve them. These are Gemini types, not a proposed
provider-neutral API.

```ts
interface PaginationResult {
    conversations: ConversationListItem[];
    total: number;
    stoppedEarly?: true;
    exhaustive: boolean;
    completionReason: PaginationCompletionReason;
    diagnostics: GeminiPaginationDiagnostics;
    hitGoogleLimit: boolean;
}
```

`ConversationListItem`, `ListParseResult`, `ListParseDiagnostics`,
`DetailParseResult` and `ParserMessage` are reused from W2-01. The aggregate
list result emits no `items`, `hasMore` or resumable cursor. Those remain
adapter concerns. All returned results have explicit completeness/reason;
`stoppedEarly` is either true or absent, matching the actual producer.

`PaginatedDetailResult` extends the W2-01 detail contract with the already
emitted `messageCount` and the two actual truncation reasons: `token_loop`
and `max_turns_page_limit_20`. Message ordering/deduplication, drift sums,
metadata-only retry/title provenance and first/retry raw evidence remain
unchanged.

The pagination helpers take small `GeminiPaginationListClient` and
`GeminiPaginationDetailClient` interfaces rather than a broad client bag.
RPC's parser getter now returns `GeminiResponseParserFacade`.

## Exact list options and callback shapes

`PaginationOptions` contains only the observed `maxPages`, `incremental`,
`signal`, `targetSid`, `onProgress` and `onPageBatch` options. `targetSid`
retains its existing Gemini SID/slot meaning. `forceFull` is owned by the
content/watermark layer and is not read by this pagination module; no new
force-full policy is introduced.

- `PaginationProgressCallback`: `(info: PaginationProgressInfo) => void`.
  Info has required `page`, `added`, `total`, `hasMore`; optional `batch`,
  `stoppedEarly`, `reason`. Normal progress reflects cursor presence; early
  callback-stop progress forces `hasMore: false` and `stoppedEarly: true`.
- `PaginationPageBatchCallback`: `(batch: ConversationListItem[], info:
  PaginationPageBatchInfo) => Promise<PaginationStopDecision | void>`.
  Batch info is `{page: number; hasMore: boolean}`. Decision is
  `{shouldStop?: boolean; reason?: string}`. Batches retain duplicates from
  the fetched page; aggregate results and `added` use the existing ID dedupe.
- Both options-object and legacy positional call styles remain available.
  Object options retain precedence over positional progress and targetSid.
- `GeminiListRequestOptions` explicitly describes signal, maxRetries and the
  existing `_retried`, `_retryCount`, `_overrideAt`, `_overrideBl` flags.
  `GeminiDetailRequestOptions` replaces `_retried` with `_retriedXsrf` and
  adds the already-used `detailOnly` and `altParams` flags. Custom list
  filters remain opaque `unknown` inputs to the existing JSON serializer.

Typing these flags exposed a supporting annotation mismatch: retry policy
allows a nullable fresh build label, while `resolveCred`'s override annotation
excluded null. Only its three `bl` parameter annotations now accept null;
the existing fallback logic, credential locking and account selection are
unchanged. No credential storage or retry-policy redesign is included.

## Completeness states preserved

| Existing trigger | completionReason / outcome | exhaustive | stoppedEarly |
|---|---|---|---|
| Empty page without Bard evidence or populated page without cursor | `natural_exhaustion` | true | absent |
| Watermark or any explicit callback `shouldStop` (even without cursor) | `unchanged_boundary` | false | true |
| Repeated cursor | `token_loop` | false | true |
| Positive maxPages reached while cursor remains | `max_pages` | false | true |
| Empty page with Bard evidence; rate-limited fetch after partial data | `hit_google_limit` | false | true |
| Other fetch error after partial data | `error` | false | true |
| Client/signal cancelled before start; cancellation observed at loop boundary | `aborted` | false | true |
| First-page fetch error, including HTTP 429; callback exception | rejects; no aggregate result | n/a | n/a |

Custom callback reason text is preserved in diagnostics/progress. There is no
new `callback_stop` completion value: today's mapping remains
`unchanged_boundary`. No result derives completeness from progress `hasMore`.
GeminiProvider's existing `hasMore = !!stoppedEarly` and `nextCursor = null`
compatibility mapping are untouched for W2-03/W2-05 to migrate later.

`PaginationCompletenessEvidence` models only the flags the compatibility
helper reads, with optional fields and nullable nested limit evidence. Its
`completionReason` accepts strings because the old helper rejects any
non-natural reason, including unknown reasons. Missing legacy flags still
mean exhaustive; null input and explicit incomplete flags still mean false.
The guard implementation is unchanged, not replaced by a permissive
interpretation of the new producer contract.

Three locally reproduced edge behaviors are explicitly retained, not fixed:

1. A negative maxPages value produces a zero-iteration result currently
   marked natural/exhaustive. Zero maxPages retains the 2000-page fallback.
2. An empty parser result with `NO_INNER_STR` but no Bard evidence is currently
   classified natural/exhaustive. Diagnostics retain that parser failure.
3. A fetch rejecting with AbortError after partial data maps to `error`,
   whereas cancellation observed before/at the loop maps to `aborted`.

The first two are completeness-policy hazards for a separate semantic review
(W2-08 handoff). This typing task does not relabel them or weaken the guard.

## Diagnostics and evidence

`GeminiPaginationDiagnostics` explicitly names start/end time, maxPages,
incremental, totalPagesFetched, totalConversations, stopReason, hitGoogleLimit
and pageHistory. Each `PaginationPageDiagnostic` has page/count, nullable
requested/next token previews (`{len, preview}`), cursor presence and
`ListParseDiagnostics | null` debugInfo. Diagnostic previews and Bard strings
remain evidence, not validated wire/domain objects. Detail `_raw` remains
`unknown`; metadata-only array probes are unchanged and still partially
validated. Error `.message` reads use an unknown-valued diagnostic projection
without changing the old property-read behavior or error text.

`pagination.ts` has no explicit any and passes an ad hoc whole-file check.
This does not certify unknown raw arrays: library `Array.isArray` narrowing
still exposes unchecked elements in metadata-only probes.

Remaining unrelated explicit escapes are intentionally deferred:

- `geminiClient.ts`: constructor option extension bag, global abort mirrors,
  retry429 aborted casts, and the existing parseDetail error catch.
- `rpcClient.ts`: request credentials, utils getter and timeout handle.
  `AbortSignal.any` is an API name, not a typing escape.
- `credentialManager.ts`: credential-store getter and existing DOM/global
  credential extraction/catch/callback escapes; only nullable bl annotations
  changed here.
- Parser raw-wire and provider/content escapes listed in W2-01/W1 audits
  remain unchanged. No Provider or syncEngine file is edited.

## Verification

All four production files emit byte-identical JavaScript against `05c37d3`
using esbuild transform with loader `ts`, target `chrome120`, ESM format,
syntax/whitespace minification and unchanged identifiers. No expression is
normalized or excluded from the comparison. This proves the patch changes
no parser, pagination, cancellation, sorting, request or reconciliation
runtime behavior. Tier 2 triggers in AGENTS.md therefore do not apply to
this type-only patch; no live or Tier 3 visual pass is claimed.

The new `pagination_contract.test.ts` contains 18 type/behavior
characterizations covering all seven reason values, legacy guard inputs,
callback/positional precedence, diagnostics identity, partial/error/abort
semantics, detail truncation/metadata retry and the retained edge behaviors.
W1's 19 parser boundary characterizations are untouched.

| Check | Result |
|---|---|
| `npm run type-check` | Passed |
| Parser boundary characterizations | 19 unchanged cases passed |
| Provider-focused tests | 4 matched suites passed |
| Gemini client-focused tests | Passed |
| Pagination / new contract-focused tests | Passed; 18 new characterizations |
| `npm run test:changed` | 66 affected unit suites and 43 E2E cases passed |
| `CI=1 npm test` | Scoped zero-any, type-check, 193 unit suite files, build and 43 E2E cases passed |
| Ad hoc pagination explicit-any check | Passed; permanent gate unchanged |
| Production JavaScript emission comparison | All four files byte-identical |
| `npm run pool:status` | 20/20; no scenarios consumed |
| `git diff --check` | Passed |
| Tier 2 / Tier 3 | Not triggered by the type-only patch; no pass claimed |

Validation logs and the emission comparison script/results are retained in
the core checkout's ignored `temp/w2-02-validation/` directory.
