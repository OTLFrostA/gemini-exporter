# W3-01 — Shared type foundations

Baseline: main `851adb9` (W2-08 / PR #772). This phase hardens four shared
contract files by the source of their types, without scanning downstream files
for unrelated `any` or changing storage/export schemas.

## Root causes and contracts

| Root | Shared contract | Direct adaptation |
| --- | --- | --- |
| Normalized messages previously exposed untyped collections | `MessageCitation`, `DocumentLink`, `MessageDocument`; live records contain `ChatMessage[]` | Parser citation/report interfaces specialize shared types. Shared types never import the Gemini parser. Takeout/export synthesized reports fit the same document contract. |
| Account metadata was an open untyped map | `AccountSlotInfo` / `AccountSlots` name existing profile, count and ISO last-sync fields | UI store and account view annotate the same map. No storage reader, writer or migration changes. |
| UI operations had untyped arguments/results/callbacks | Reconciliation ID projection/options, existing export-state type, session/failure/progress types, scan/stop callbacks, export options/callbacks/summary, tour steps | Store/view/controller public edges and the actual tour-step array adopt the shared contracts. Callback text/source/legacy record arguments become optional where actual invocations omit them. Options reload callbacks and implementations return `Promise<void>`. |
| Directory permission/nullable state was hidden by `any` | `DirectoryHandle` extends the standard browser directory interface with permission methods; stored/current/restored handles admit null; a successful picker returns a handle | The shared controller contract reflects existing behavior; IDB and picker implementation hardening is deferred. |
| Generic browser transport and string formatting were mistaken for known data | Generic transport accepts/returns `unknown`, including raw status responses and background open/reload fallback responses. Translation substitutions accept `unknown`, matching explicit `String(value)` conversion. | Opaque input functions use function properties, so narrow implementations cannot pass through method bivariance. Translator rest arguments adopt `unknown[]`. No generic caller-selected response type pretends to validate transport data. |

The UI export contract is a projection for the workbench: PDF does not supply
attachment counters or a skipped count, so the common summary preserves optional
fields. `TakeoutExportSource` names only the three capabilities used by export;
`TakeoutImportResult` exposes conversations and media count consumed by import UI.
ZIP entry/index caches are still owned by Takeout and are not duplicated as a new
shared schema. Neither export formats nor Takeout parsing/matching behavior changes.

Existing `sources: unknown[]` and `structuredContent: unknown` remain unverified
source payloads. Failed-attachment source evidence is also opaque. These are not
substitutes for known internal message, profile or callback shapes.

## Runtime impact

Esbuild output compared against baseline is identical for 16 of the 17 changed
production TypeScript files, including both parser files. The sole emitted change
is in `dialogView`: `(session.failedCount ?? 0) > 0` makes the existing absent-count
behavior explicit after declaring `failedCount?: number`. Missing/zero counts
still use the success banner and positive counts use the warning banner. A direct
regression covers all three cases. No new assertion or non-null type lie is used.

## Permanent gates and deferred debt

`scripts/zero-any-files.json` now gates 18 whole production files, including all
four W3-01 shared files. The compile-time regression uses static imports, exact
field/parameter/awaited-result equality and typed fixtures without casts or
suppressions. It checks parser/shared and PDF/UI compatibility, nullable clearing,
invalid primitive collection elements and rejection of narrow opaque-input
functions. It also pins directly adapted public producer signatures.

This is a shared-contract closeout, not a claim of downstream zero-any:

- `tabService`, `messaging`, background batch fetching and module overrides still
  own raw browser-message responses, error probing and test injection. Raw result
  validation belongs to a transport boundary task.
- Export orchestrator/PDF internals and injected workers still contain legacy
  option/queue/asset shapes. The new workbench projection does not harden those
  complete engine surfaces or add them to the whole-file gate.
- Storage account-map decoding, IDB handle decoding, directory-picker feature
  detection and permissions are not migrated in this phase.
- Mixed UI modules, tour event targets and live-save implementation internals
  retain unrelated `any`; only direct signature adaptations are included.
- Raw parser candidate/turn/media payload probes remain parser boundary debt.
  No parser/media/title design, reconciliation policy or UI/export feature changes
  are included.

## Validation

- Exact compile-time contract suite and completed-session banner regression pass.
- Scoped zero-any gate and strict TypeScript check pass.
- Dependency-aware test run passes: 123 impacted unit suite files, build and
  all 43 affected Playwright tests (no retry required).
- Scenario pool: 20/20; no live scenarios consumed.
- `CI=1 npm test`: zero-any, strict types, 198 unit suite files, production build
  and all 43 Playwright tests pass without retries.

Parser emitted code is identical and no network interception, conversation sorting,
Takeout import logic or release behavior changed; Tier 2 trigger conditions do not
apply. Tier 3 was not assigned. Validation logs and emission report are preserved
in the core checkout's ignored `temp/w3-01-validation/` directory after closeout.
