# v2 integration cleanup

Base: `dev/v2` after UI PR #1058 (`2f78e71c9551c4eec863cdbc21965e8f92bcf8b1`).

The module migrations had removed v1 entry points while old tests and several
production callers still expected those contracts. This cleanup retires those
contracts and fixes integration. The complete Tier 1 gate still fails on unrepaired legacy tests.

| Retired contract | Current coverage / implementation |
| --- | --- |
| Class export engine, batch worker, direct asset writer, persisted export sessions | Application export/cancellation tests, L4 packaging and production download/ZIP/PDF specs |
| Storage aliases, exportedIds, full-chat Content writes, slot identity | storage_v2, Domain admission/Registry, six-module integration and browser Registry tests |
| Old Options/Popup globals, UI-side formatting/Skip/ZIP | ui_v2 unit/browser suites; production Options export and record/Skip assertions |
| Completion-driven alternate Live Save writer | Runtime changed-Detail contract tests and passive capture → real Background folder write |
| Tour/ZIP durable preferences | lifecycle, migration and UI guidance contracts |
| Old detail IPC/native transport and default/first-tab fallback | L1 acquisition, Runtime UUID routing and production ambiguity/default-account checks |
| Destructive account cleanup buttons | Application cleanup tests and production retention across reload |

## Test migration correction — scoped completion

The initial cleanup wrongly deleted tests when their imported v1 modules no longer
existed. Those deleted files and cropped mixed-suite scenarios have been restored.
They remain in normal test discovery. The [migration inventory](v2-test-migration.json)
tracks restoration separately from verified migration; restoration alone is not completion.

Migrate each scenario to the current public owner APIs, retaining its behavioral
assertions. Where the frozen v2 design changes behavior, update the assertions and
identify that change explicitly. Do not restore a v1 production compatibility layer,
skip failing tests or replace old regression coverage with a few generic smoke tests.

The user requested stopping further migration and merging the completed scope into
`dev/v2`. Earlier green CI applied to the reduced suite and does not establish full
migration. Unrepaired tests remain unchanged and in normal discovery; unresolved
imports and failed assertions remain visible. No auto-merge is enabled.

Production fixes include strict Scan account resolution, automatic Browser ZIP,
per-conversation Folder delivery finalization, nondestructive record cleanup,
URL-driven Tour lifecycle, event-driven Badge refresh and relative request URL
normalization in MAIN capture. No compatibility pipeline is reintroduced.

The Node runner discovers suites and runs complete files. Module manifests
no longer select test-name patterns. Type gates check the whole project without
excluding external diagnostics. The Python entry point runs offline harness unit
tests in separate processes to avoid module-name shadowing.

Previous reduced-suite validation: `npm test` (zero-any, whole-project tsc, Node and offline
Python suites, production build, fixture-based Playwright). The production browser
suite loads the built extension and real business modules; network responses are
fixtures. It inspects actual download/folder bytes, extension-origin persistence,
ExportRecords, account routing and Badge. Unit tests separately establish duplicate
admission suppression. Native handle coverage uses OPFS, not a user-selected OS
folder. No live Google account, Tier 2 or Tier 3 validation is claimed.

## Tier 2 probe alignment

The live harness now uses a test-only bundle built from public v2 owner APIs.
It is injected into Options by CDP and is not shipped with the extension. Reads
use Registry UUIDs, account-scoped Index/Detail, ExportRecords and the single
Recent `StreamCoverage { range }`. Coverage reset clears only Coverage. Settings
and native handle setup call their current owners. No old Storage keys, UI globals
or `domainStorage`/`deepScan`/detail IPC routes are restored.

Scan still clicks the actual Scan All button. A temporary MutationObserver captures
busy transitions (including synchronous completion) and the UI's own final status
and counters. Idle clicks, account switches, cancellation, unknown results and
partial limits fail completeness checks. Recent Coverage has no v4 generation,
historyComplete or pinned-stream certification fields. A persisted null range
remains valid but does not certify a trusted interval.

Native differential capture wraps Options fetch without changing arguments,
Promise identity or Response consumption. It clones successful real DETAIL
responses, drains pending reads and retains exact raw text plus each request's
third-argument cursor. The audit rejects broken/missing cursor chains, wrong
conversation identities and rejected turns, and merges pages oldest to newest.
Restoration runs on capture/read failure as well as success. This is source
observation, not a second fetch.

Takeout uses the real file-input UI and validates committed Domain via the normal
read path. Resource bytes and SHA256 are checked against the source-bound archive
parser, within that inspection task. v2 does not persist archive bytes in Domain;
this probe does not claim otherwise. The existing cleaned Takeout fixture retains
unresolved-media diagnostics; a partial result remains visible rather than being
reported as a successful complete resource import.

UI checks now use explicit selection and displayed ExportRecord history. They do
not require removed badge classes, automatic selection or a durable Tour flag.
Deletion probes currently expect webpage deletion followed by local archive retention;
this expectation has not been live-validated against the current Domain deletion contract.
There is no invented v2 cloud-availability field. Rows expose their actual
conversation ID for stable test targeting.

The fixture-based `tier2_v2_probes.spec.ts` runs as Tier 1 and exercises the actual
injected probes against the built extension. Live Google, profile restart and
Tier 2/3 execution remain unvalidated here. CI's unit job now installs Chromium
because the active native Storage unit contracts require it.

## Verified scope retained for merge

- 29 migrated unit suites: 150 passing cases.
- 10 migrated fixture-based browser suites: 27 passing cases.
- Eight additional migrated UI regressions in `ui_legacy_safety.test.ts`; the six
  original mixed suites remain unchanged at the baseline.
- Three Python UI source guards pass; the existing `ui_v2.spec.ts` adds 11 passing
  regression checks after shared harness extraction.
- Production build passes. Whole-project TypeScript reports 328 diagnostics in
  unrepaired tests; no diagnostics reference files changed in this repair round.
- No test files are deleted relative to the pre-cleanup baseline. No discovery
  exclusions or skips were added to hide remaining failures.

The final repair also bounds Popup account-context messages using the existing
Tab transport timeout, preventing a missing response from leaving Popup blocked.

`realtime_delete.spec.ts` remains unchanged. A trial migration exposed missing
`onConversationDeleted` wiring in Content's MessageBridge initialization; that
Runtime issue is outside UI scope and is not fixed or claimed passing here.
Tier 2 and Tier 3 were not run.
