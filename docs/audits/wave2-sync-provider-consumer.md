# W2-05 syncEngine Provider consumer migration

Baseline: `9f2729b` (#768). Provider core/registry/resolver, Gemini adapter,
parser, pagination, storage schema, title priority and cancellation APIs are
unchanged. Production edits are confined to `src/content/syncEngine.ts`.

## Typed acquisition and canonical fields

Five provider-path escapes are removed: tryBatchExecuteFull's Promise<any>,
page1Batch any[], the all:any result, onPageBatch's any[] argument and onProgress's
any argument. The result is GeminiProviderPageResult; callbacks infer the frozen
Gemini option contracts, and the first-page snapshot is
GeminiProviderConversationItem[]. ProviderSyncResult declares count, typed
GeminiPaginationDiagnostics and hitGoogleLimit (or null when no scan result).

Final count and reconciliation now read `items`, never the legacy conversations
alias. The adapter still produces both names for other consumers, but sync no
longer depends on the alias. A test gives the alias a throwing getter and
exercises the actual production scan entry, so a legacy read fails the test.

Active detail acquisition already receives the explicit Gemini detail companion
through the named application boundary. Its title/time/provenance reads remain
typed and unchanged. The two existing single ApplicationProvider assertions
remain at sync's resolver sites: the current production acquisition is Gemini,
while neutral registry/resolver infrastructure stays independent. No runtime
provider capability guard is claimed; future provider/evidence mapping remains
consumer migration work, not a new contract redesign here.

## Reconciliation safety and typed Gemini evidence

The safety expression remains:

```ts
effectiveForceFull && !contentContext.isAborted() && isPaginationExhaustive(all)
```

`all` now supplies the required frozen producer exhaustive/completionReason
fields and typed stop/Google-limit evidence. The existing guard still vetoes
stoppedEarly, top-level/nested Google evidence, false exhaustive and non-natural
reasons. No decision infers completeness from hasMore. Natural full scans can
reconcile; watermark, token loop, max pages, Google limit, error, abort and
context cancellation cannot prune unseen historical cloud records. The existing
empty-complete-account no-prune policy and checkpoint behavior are preserved.
The legacy helper's missing-flag compatibility and W2-02 negative maxPages /
empty NO_INNER_STR / partial AbortError findings are not relabeled or repaired.

Google-specific evidence is named locally as typed diagnostics plus the direct/
nested hitGoogleLimit boolean. Diagnostic persistence, scan result, Takeout
prompt payload and scanProgress retain their values and references. The existing
sliding-window count heuristic remains a UI hint, distinct from direct Google
limit evidence; it is not added to the reconciliation guard. No UI text changes.

Server timestamps, nullable creation time, RPC title authority, account-slot
selection, old-chat recency/merge ordering and keepTakeout behavior are retained.
No timestamp is coerced, fabricated or remapped by this provider migration.

## Regression coverage and runtime scope

Six new cases exercise tryBatchExecuteFull with typed providers/storage traces:

- Complete canonical list reconciles absent cloud entries and retains Takeout,
  authoritative times/title provenance and u2 account isolation.
- All six incomplete reasons keep unseen historical cloud entries even when
  hasMore=false; no complete-scan checkpoint is established.
- False exhaustive, direct/nested Google evidence and context cancellation
  independently veto reconciliation, even with otherwise complete flags.
- Watermark callback returns the exact existing stop reason and incremental
  maxPages/targetSid controls.
- Google diagnostics retain prompt/progress/result evidence; count heuristic
  stays distinct from the direct-limit prompt flag.
- Empty complete result preserves conservative no-prune/checkpoint behavior.

Compile-time checks use Awaited<ReturnType<tryBatchExecuteFull>> and the diagnostic
field to reject any-valued results. Existing provider/parser tests remain intact.
No storage reconciliation policy is reimplemented in production; the harness
observes the real scan's reconciliation call and models its destructive effect
on historical records to make an unsafe call visible.

Emission comparison checks nine existing modules against the baseline. The sync
module intentionally differs for canonical field reads and typed diagnostic
bindings; eight other provider/content boundary modules remain byte-identical.
Additionally, the sync source prefix before the scan entry emits identically,
covering active-detail, DOM, merge/upsert, ingest/watermark and timestamp/title
functions. No full-patch type-only or byte-identity claim is made.

AGENTS.md Tier 2 triggers (parser/JSPB, Takeout import, sorting, interception or
version release) are not modified. Canonical items and conversations are the same
adapter-produced array; request/callback and reconciliation algorithms remain
unchanged. Tier 2/3 are not triggered; no live/visual pass is claimed.

## Remaining unrelated any and gate eligibility

Current syncEngine line/category inventory (line numbers may move):

| Lines | Deferred category |
|---|---|
| 110 | Stored-record lookup during active-detail scheduling |
| 194 | Active DOM/sidebar metadata record |
| 224, 228, 260–262 | Storage queue, mixed incoming/stored records, transaction Map/callbacks |
| 310 | Account/profile metadata extension record |
| 379, 397, 427–428 | Shared sniff/provider ingestion and checkpoint timestamp probes |
| 510 | DOM/sidebar polling item collection |

These total 14 explicit any occurrences on 13 lines. Shared ingestion/storage
functions accept mixed records, beyond the provider acquisition contract; they
remain deferred instead of being claimed as strongly typed storage boundaries.
ActiveClientContract, module-override DI, router/live-save/export escapes also
remain outside this task. No new any or double assertion is introduced.

**The whole syncEngine file is not eligible for permanent zero-any scope.**
No gate/package script is changed, and no enforceable partial-file permanent
gate is claimed. W2-08 owns the final whole-file scope decision.

## Validation

| Check | Result |
|---|---|
| `npm run type-check` | Passed |
| Provider-focused tests | 7 matched suites passed |
| Sync-focused tests | New 6-case production-entry suite passed |
| `npm run test:changed` | 12 affected unit suites and 10 E2E cases passed |
| `CI=1 npm test` | Scoped lint, strict types, 196 unit suite files and build passed; 42 E2E passed first attempt, 1 passed on configured retry |
| Focused onboarding PDF E2E retry | 1 passed first attempt |
| `npm run pool:status` | 20/20; zero scenarios consumed |
| Emission comparison | Sync scan differs as described; protected prefix and eight other modules byte-identical |
| `git diff --check` | Passed |

The full run's PDF onboarding case initially timed out waiting for tour-step
badge `1 / 7`, then passed on its configured retry (reported as 1 flaky). The
required incremental run covers only synchronization-related specs, so the
onboarding case was also rerun separately and passed without a retry. No tour
code or UI assertion was modified to obtain these results.

Logs/emission evidence and the unrelated-any inventory are retained in the core
checkout's ignored `temp/w2-05-validation/` directory.
