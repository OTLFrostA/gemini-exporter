# dev/v2 Tier 1 repair audit

Baseline: `bb1d4d162e32bceec5347c243c07f60e9971c64f` (`dev/v2`).
Working branch: `codex/dev-v2-tier1`. Final verification also incorporates the later `dev/v2` Tour update, `de6080120b9ceabaedad9646fa19a652d4fbe0d5`.

Design reference: [Gemini Exporter v2｜主架构（模块总览）](https://www.notion.so/3fa5d4d759e18153911bed2246079b4e), including the linked L1, L2, Composer, AST, Export, Format, Packaging and UI contracts.

The initial independent audit discovered 336 unit-test files, of which 63 failed. Ordinary discovery remains enabled for every file. No failure was hidden with a skip or an excluded test path.

## Implementation corrections

- Source timestamps truncate submillisecond precision. Gemini seconds/nanoseconds tuples truncate the fractional component before addition, avoiding floating-point carry into the next millisecond.
- Move archive-path normalization into Shared. Format validates supplied paths without a runtime dependency on Packaging; Packaging uses the same pure validation.
- Retain HTTP response media types in acquired resources when the source facts omit a media type. Actual PNG/SVG bytes now receive matching Packaging extensions and PDF mounts.
- PDF unavailable-image placeholders retain authored alternative text as well as captions. Missing inline images do not expose an invented internal resource identifier as authored text.
- Options account and search controls expose translated accessible labels.

## Test migrations

The obsolete interfaces have been replaced at their current owners, retaining the behavioral scenarios:

| Retired assumption | Current verification |
| --- | --- |
| Content-side detail resolution, active title fetching, DOM/debounce Live Save | L1 passive capture commits to L2; only changed accepted Detail requests keyed unified Export |
| ExportController/PdfExporter/BatchWorker own parallel pipelines | Application `runExport`/`runLiveSave` with real storage, composition, preparation, Packaging and Delivery |
| Persistent Session/Checkpoint and derived updated/failed records | Independent tasks, explicit cancellation, minimal latest ExportRecord, transient failure/retry UI |
| Global/persistent Takeout media cache | Task-owned resource readers, exact conversation/asset ownership, release without deleting admitted Domain |
| Arbitrary source list stop flags | Committed pages, natural end, request-bound structured provider limit, internal safety budget and truthful UI counters |
| Canonical schema headers and message IDs in display AST | Format-neutral AST and positional Typst transport |
| Format preselects resource names or delivery receipts enter records | Packaging assigns paths; physical output and minimal records verified independently |

PDF checks retain real disk round trips: Folder Writer produces a PDF read back from disk; Browser Delivery produces a ZIP written and reopened from disk with three distinct PDFs and distinct body markers. A separate stress check executes real Typst WASM compilation for two conversations/40 messages by default; `RELEASE_STRESS=1` retains the 100-conversation/2000-message mode. The existing local attachment-budget specification helpers are specification examples, not evidence of production enforcement of a conversation-wide byte budget.

Runtime tests cover malformed/missing resource replies, duplicate callbacks, oversized IPC, foreign accounts, late feedback after account changes, cancellation followed by an independent retry, storage-write failures and recovery, and distinct bytes surviving colliding authored filenames. Browser UI tests exercise the current UI with explicit Application/Runtime port doubles.

The general unit runner now applies the existing frozen L1 preload to the three suites that require it, matching the dedicated L1 runner. Test helpers restore account-runtime globals and handle an initially undefined Chrome host. Parser-corpus math injection uses the internal renderer hook rather than an ignored public argument; provenance classification describes synthetic project contracts without claiming real-source evidence.

## User decisions applied

- Truncate all submillisecond source times.
- Reliable confirmed cloud deletion follows Notion v2: atomically delete the same-key Index, Detail and ExportRecord. Other accounts remain intact; ambiguous failures retain local data.
- Concurrent deletion after an export already read its snapshot remains unspecified, as explicitly accepted by the user. No new coordination rule was introduced.

## Validation

The first full `npm test` passed on the original baseline with these repairs: zero-any, TypeScript, all 336 discovered unit-test files, production build and 121 Playwright cases.

Full `npm test` also passed after incorporating `de608012` and repairing the Tour test timing: zero-any, TypeScript, all 336 discovered unit-test files, production build and 121 Playwright cases. The new Tour animation can temporarily move the final navigation button outside the viewport; the existing geometry/hit-test assertions now poll for the settled result, without a fixed sleep or relaxed assertions.

Additional CI entry points passed locally: `npm run test:v2:unit-isolation` (10 owners) and `npm run test:v2:unit-ports` (10 mock/test files, no scoped diagnostics). Subsequent upstream changes to Options progress display are validated together with this branch by the PR merge-ref CI.

Scenario pool: 20/20. No Tier 2 or Tier 3 live execution was requested or performed.
