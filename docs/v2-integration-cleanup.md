# v2 integration cleanup

Base: `dev/v2` after UI PR #1058 (`2f78e71c9551c4eec863cdbc21965e8f92bcf8b1`).

The module migrations had removed v1 entry points while old tests and several
production callers still expected those contracts. This cleanup retires those
contracts, fixes integration and restores one complete Tier 1 gate.

| Retired contract | Current coverage / implementation |
| --- | --- |
| Class export engine, batch worker, direct asset writer, persisted export sessions | Application export/cancellation tests, L4 packaging and production download/ZIP/PDF specs |
| Storage aliases, exportedIds, full-chat Content writes, slot identity | storage_v2, Domain admission/Registry, six-module integration and browser Registry tests |
| Old Options/Popup globals, UI-side formatting/Skip/ZIP | ui_v2 unit/browser suites; production Options export and record/Skip assertions |
| Completion-driven alternate Live Save writer | Runtime changed-Detail contract tests and passive capture → real Background folder write |
| Tour/ZIP durable preferences | lifecycle, migration and UI guidance contracts |
| Old detail IPC/native transport and default/first-tab fallback | L1 acquisition, Runtime UUID routing and production ambiguity/default-account checks |
| Destructive account cleanup buttons | Application cleanup tests and production retention across reload |

The [machine-readable retirement audit](v2-test-retirement.json) lists retired
suite dependencies, removed cases in mixed suites and the complete deleted-file
inventory. Retirement means that the v1 implementation/API no longer exists; it
does not claim a one-to-one replacement for every old assertion. Mixed suites
retain active parser, Domain, renderer and retry regressions. Type-only contracts
remain checked by whole-project tsc where they refer to current APIs.

Production fixes include strict Scan account resolution, automatic Browser ZIP,
per-conversation Folder delivery finalization, nondestructive record cleanup,
URL-driven Tour lifecycle, event-driven Badge refresh and relative request URL
normalization in MAIN capture. No compatibility pipeline is reintroduced.

Unit runners discover all active suites and run complete files. Module manifests
no longer select test-name patterns. Type gates check the whole project without
excluding external diagnostics. The Python entry point runs offline harness unit
tests in separate processes to avoid module-name shadowing.

Validation: `npm test` (zero-any, whole-project tsc, all active Node and offline
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
Deletion checks assert actual webpage deletion followed by local archive retention;
there is no invented v2 cloud-availability field. Rows expose their actual
conversation ID for stable test targeting.

The fixture-based `tier2_v2_probes.spec.ts` runs as Tier 1 and exercises the actual
injected probes against the built extension. Live Google, profile restart and
Tier 2/3 execution remain unvalidated here. CI's unit job now installs Chromium
because the active native Storage unit contracts require it.
