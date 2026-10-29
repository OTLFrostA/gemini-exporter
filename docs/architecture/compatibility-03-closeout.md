# Compatibility 03/03 — Legacy API and test-facade closeout

Source task: [Compatibility 03/03](https://app.notion.com/p/3f85d4d759e1817aa331f942b213e7d0).
Audit baseline: `main` at `876c7fdda4b7a75c0c6ba20f1cb6211e520b99c0` (2026-10-28 Pacific).
Counts below describe direct `symbol(...)` call sites in the closeout branch, excluding
function declarations, type references, and comments. Production = `src/` outside
`src/migration/`; historical parser fixtures remain exclusively in `tests/`.
The script column is kept separate to account for dynamic Tier2/probe entrypoints.

| Function / entrypoint | Production | Tests | Migration | Scripts | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| `parseGeminiTakeoutZip` (single-record ZIP IO) | 0 | 0 | 0 | 0 | Deleted: former test-only export (five test calls); tests now exercise the production batch ZIP boundary. |
| `parseGeminiTakeoutZipArchive` | 1 | 7 | 0 | 1 | Keep: `importTakeout` consumes this; probe script loads it dynamically. |
| `readTakeoutBytes` | 1 | 9 | 0 | 1 | Keep: source-bound archive resource acquisition after successful admission. |
| `createTakeoutResourceResolver` | 3 | 14 | 0 | 0 | Keep: real Takeout source-to-archive resource matching. |
| `ensureUpgraded` | 1 | 43 | 0 | 0 | Keep: `runtime/background/readiness.ts` is its only production caller. |
| `upgradeReleasedV17` | 0 | 0 | 1 | 0 | Keep: called solely from `migration/upgradeV1.ts`. |
| `parseLegacyStorageConversation` (fixture only) | 0 | 3 | 0 | 0 | Keep in `tests/helpers/recordFixture`, never in runtime. |
| `parseConversationRecord` (fixture only) | 0 | 2 | 0 | 0 | Keep test-local source-format characterization; not production v1 migration. |
| `GeminiParserAttachments` aggregate object | 0 | 0 | 0 | 0 | Removed unused test-only object, CJS assignment, and default export. Named fixture functions remain. |
| `inferLegacyProviderId`, `extractC2PATimestamp`, `getTakeoutMediaForChat` | 0 | 0 | 0 | 0 | Already removed from current sources; no return to old facades. |

The historical `engine/generatedMediaIdentity.ts` re-export, `core/compatibility/`
tree and its `legacyGeneratedMediaReconciliation` module are already absent.
Do not infer absence or redundancy from the word *legacy*: UI's `legacyLabels.ts`
is used by current settings; provider Markdown compatibility rules remain active.
The production high-resolution resource behavior is not an argument for restoring
the old Gemini attachments wrapper.

## Runtime boundaries and dynamic access

- `src/l1/imports/takeout/importTakeout.ts` calls batch ZIP parsing and
  `readTakeoutBytes` directly. The decoder validates ZIP size *before* load
  and entries *after* load; no second import-layer guard was added here.
- `readArchive.ts` accepts optional `readArchive` injection in the context.
  This is an explicit archive-reader test seam, **not** a second public parser
  or a production dependency on test fixtures. Production falls back to the
  packaged `JSZip.loadAsync` global; tests/probe inject a deterministic reader.
  No `moduleOverrides` reference or computed export-object consumer was found
  for the retired single-record ZIP API.
- The mock TypeScript test runner now uses Node and its existing
  `ts_register.js`/L1 preload path; an obsolete JavaScriptCore preloader with
  stale `src/core/*`, `takeout_engine.js`, and `mediaIndex.js` remaps was
  removed. The normal `npm test` runner already requires Node.
- `tests/arch/semantic-layer-boundary.test.ts` rejects retired names in
  production sources, preserves the retired-directory gate, and asserts that
  `migration/upgradeV1.ts` is reached from background readiness alone.
  The check deliberately does not prohibit current resource/decoder functions.

## v1 profile upgrade remains independent

`src/migration/upgradeV1.ts` copies admitted Account/Index/ExportRecord/Settings
and DirectoryHandle facts from released v1/v1.7 and never imports historical
parser fixtures. `tests/upgrade_v1.test.cjs` is a real fake-indexeddb suite,
loaded through `tests/upgrade_released_v17.test.ts` in Tier 1. It covers
idempotence, source preservation, invalid labels, retry and account isolation.
This is a test of the actual storage upgrade, not a request to re-enable
legacy conversation-body interpretation.

## Validation / remaining environment requirement

This change deliberately removes test-only exports, not the normal v2 importer,
resource acquisition, archive limits, or storage upgrade.
Run the PR's type-check, Tier 1, build, Playwright and architecture tests.
The authenticated *live* Gemini Tier2 gate cannot be inferred from static
analysis or a green unit-test run; record its independent execution result
before marking the parent Compatibility task fully verified.
