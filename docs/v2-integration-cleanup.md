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

Live-test harness boundary: the Tier 2 helpers under `scripts/framework` still
contain v1-only probes (`getConversationDetail` capture, `deepScan` interception
and `domainStorage` inspection). They are not production callers or part of the
fixture-based extension acceptance above. Their offline helper unit tests still
pass, which does not prove the live probes work with v2. Migrating that live
harness remains separate work; no Tier 2/3 run or readiness is claimed here.
