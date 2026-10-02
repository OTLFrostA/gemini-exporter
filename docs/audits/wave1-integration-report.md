# Wave 1 integration verification (W1-05)

Date: 2026-10-02. Verification baseline: `a35158c` on main.
**All four components are integrated; overall Wave 1 acceptance is NOT complete
because the required repository-wide lint command fails.** This report adds no
architecture or production changes.

## Integrated components and conflicts

| Component | Already merged commit / PR | Verified scope |
|---|---|---|
| W1-01 Title/Merge typing | `15700df`, #757 | titleUtils/mergeUtils, nullable shared times/sidebarIndex, characterization tests |
| W1-02 Scoped zero-any gate | `8966cf7`, #758 | package script, npm test, CI Unit Tests & Syntax, source developer guide |
| W1-03 Parser boundary characterization | `25400d9`, #759 | 19 characterization tests and RPC/JSPB audit; no production parser edits |
| W1-04 Provider contract audit | `a35158c`, #760 | provider audit and two adapter characterization tests; no provider contract edits |

All four commits are ancestors of the verification baseline, in dependency order.
No merge or cherry-pick is necessary; there are no conflicts to resolve. The core
checkout started clean on main. Verification/report work uses an independent
worktree. No unrelated worktree or user change is altered.

## Zero-any and behavior verification

Protected production scope remains exactly:

- `src/core/utils/titleUtils.ts`
- `src/core/utils/mergeUtils.ts`

`npm run lint:zero-any` succeeds. Source inspection finds no explicit any,
`as any`, `any[]`, `Record<string, any>`, double assertion `as unknown as`, or
TS/lint suppression bypasses in either file. The word “any” appears only in
ordinary prose comments. The gate uses no-ignore/disable-nested-config and the
TypeScript no-explicit-any rule. Both `npm test` and the non-documentation CI
Unit Tests & Syntax path invoke this gate. Documentation-only CI retains its
existing fast path; it cannot modify the protected production files.

Title order remains `rpc > api-detail > dom > takeout > openai > sniff > legacy >
default` for source selection. Rank ties remain rpc/api-detail=50 and
takeout/openai=30. The existing implementation still puts Takeout above prompt
fallback; older prose saying prompt above Takeout is not an instruction to change
behavior. Title/Merge characterizations retain empty-title protection,
provenance, monotonic activity time, earliest creation time, fuller body retention
and incoming extension data. Existing full-suite ordering/merge coverage remains.

`git diff --exit-code 3327ff7..a35158c -- src/core/api src/core/provider src/content`
is empty: parser implementation, provider public contracts/adapters and content
consumers are unchanged throughout Wave 1. Shared conversation edits only add
nullable updatedAt/createdAt and sidebarIndex. Provider proposal code exists only
in the audit document. W1-05 changes no production file or test expectation.

## Required verification results

| Command/check | Result |
|---|---|
| `npm run lint:zero-any` | PASS |
| `npm run type-check` | PASS |
| `python3 tests/run_tests.py --filter title_merge_characterization` | PASS, 1 suite / 4 characterizations |
| `python3 tests/run_tests.py --filter parser_boundary_characterization` | PASS, 1 suite / 19 characterizations |
| `python3 tests/run_tests.py --filter provider` | PASS, 4 matched suites (includes local-font-provider) |
| `npm run test:corpus` | PASS, 110 documents / 60 math expressions, zero diagnostics/fallbacks/compile failures |
| `npm run provenance:summary` | PASS, existing canonical/math manifest: 23 suites / 217 tests |
| `npm run pool:status` | PASS, 20/20; no scenarios consumed |
| `npm test` | PASS, scoped lint/type-check, 191 unit suites, build and 43 Playwright cases |
| `npm run test:changed` | PASS, documentation-only fast path (no additional code/browser run) |
| `npm run lint` | **FAIL**, exit 1: optionsExport.ts:619:9, typescript/no-floating-promises |

The corpus/provenance commands cover downstream canonical Markdown/math, not
RPC/provider boundary coverage; those boundaries use the focused suites above.
No new parser command was introduced in Wave 1. Tier 2/3 are not triggered by
this documentation-only integration verification, which changes no parser,
Takeout, sorting or network behavior.

### Outstanding lint failure

`src/ui/options/modules/optionsExport.ts`, export button click listener, calls
`exportSelected()` without awaiting or explicitly handling its Promise.
`git show 3327ff7:src/ui/options/modules/optionsExport.ts` confirms the same call
exists before W1-01; this is not an integration regression. It remains unchanged
on the verification baseline.

Per the Wave 1 README's scope rule, cross-scope issues are recorded rather than
silently expanding the task. No lint rule is weakened, suppression added, or
unrelated UI behavior changed. A separately scoped follow-up must review the
click handler's intended async/error behavior, handle that Promise, and rerun
`npm run lint`. Until it passes, do not claim all required Wave 1 gates are green.

## Remaining hotspots and first Wave 2 task

Remaining any outside the protected scope is documented in
[RPC/JSPB boundary audit](rpc-jspb-parser-boundary.md) and
[provider contract audit](provider-contract-audit.md): parser JSON/envelope and
JSPB schema helpers, message/attachment construction, facade/client pagination
diagnostics, provider options/index signatures, syncEngine aggregate result,
live-save/router detail transport, and downstream export/asset host seams.
None is newly added or cleared by W1-05.

After the separate lint follow-up, the recommended first Wave 2 task is **type
the existing parser schema/protocol/facade dependencies and diagnostic outputs**:
introduce explicit internal contracts for the currently widened helpers, reuse
existing media/citation/title types, and keep all 19 boundary characterizations
unchanged. Validate focused parser suites, canonical corpus and full Tier 1;
only then proceed to unknown JSON decoding and small WRB/inner-payload guards.
Do not start with a wholesale provider interface replacement or semantic fixes
for the known parser quirks. Provider migration depends on typed pagination/
diagnostics and the completeness/provenance/transport/cancellation prerequisites
listed in its audit.
