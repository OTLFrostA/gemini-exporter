# Content message type boundary audit

This batch closes the untyped browser-message entry points in Runtime Content.
It does not claim to eliminate repository-wide type debt.

## Evidence and scope

Baseline: `838036cc`. The native TS7 type check passes after installing the locked
worktree dependencies. Oxlint previously reported 19 unsafe assignment, argument
or member-access warnings in `src/runtime/content`; the same command now reports
zero. `check-domain-trust-lint.cjs` now includes the entire Content directory,
including future files, in its existing six error-level unsafe-flow rules.
A temporary new-file probe containing `event.data.result` was rejected by this
gate and removed after verification.

Four page-message receivers used the implicit `MessageEvent<any>` default.
They now accept `MessageEvent<unknown>`, validate the event envelope, and leave
provider payload validation to the existing source parsers. Origin/source checks,
account identity matching and asynchronous commit guards remain in place.

The fifth entry point, `chrome.runtime.sendMessage` in Live Save, assigned an
unchecked `response.result` to `ExportResult`. The new local response decoder
reconstructs the complete result, validates counts and attachment metadata, and
reuses `readConversationKey` for failed keys. Only explicit `null` means disabled
Live Save; malformed or missing results follow the existing error-feedback path.
Tests exercise both valid optional fields and malformed nested replies.

Five untyped entry points are closed; 19 unsafe-flow diagnostics disappear.
No existing casts were removed, and no casts or high-risk exceptions were added.
The new `unknown` annotations and one local record guard belong to actual browser
transport boundaries, not internal domain contracts. The affected production files grow from 499 to 544 lines (+57/-12);
the gate changes one line, behavioral tests add 30 lines, and one legacy
transport-reference assertion now compares the complete decoded result. No state or public
interface was added. One decoder module adds four functions (object guard, count reader,
attachment reader, response reader); the added branches validate previously
unchecked input. This added complexity prevents invalid transport data from
reaching success feedback. Existing providers and export behavior are unchanged
for valid messages.

## Reproducible syntax inventory

Both snapshots use the skill's `audit-types.cjs`, roots `src,tests,scripts`, and
TypeScript 5.9.3 via explicit `--compiler-api`. Counts include tests and scripts;
syntax hits are not confirmed defects. The new runtime checks intentionally
increase boundary annotations and `typeof` counts.

| AST category | Before | After |
| --- | ---: | ---: |
| any | 1129 | 1129 |
| unknown | 1345 | 1356 |
| object | 20 | 20 |
| broad-record | 351 | 352 |
| as-assertion | 1030 | 1030 |
| angle-assertion | 0 | 0 |
| as-const | 367 | 367 |
| non-null | 423 | 423 |
| generic-unconstrained | 49 | 49 |
| generic-constrained | 43 | 43 |
| runtime-typeof | 1051 | 1065 |
| type-query-typeof | 224 | 224 |

The complementary `audit-type-flow.cjs` scan uses `tsconfig.json` and roots `src`.
Its TS5 analyzer reports one pre-existing compatibility diagnostic in
`src/l1/client/gemini/api/credStorage.ts` (nested Promise generic inference).
It is only a candidate-finding aid, not native TS7 proof; no candidate baseline
was automatically approved. Native TS7 and Oxlint provide the executable checks.

## Remaining debt

Background Domain ingestion still asserts IPC payloads to ingestion parameter
types; review its existing L2 decoders and page-evidence validation together in a
separate batch. Other candidates include generic module overrides, UI DOM casts,
IDB directory-handle capabilities, provider-specific boundaries and test helpers.
Vendor JS diagnostics are separate from owned production TypeScript. These have
not been approved as exceptions or declared fixed by this batch.

Tier 2 and Tier 3 live tests were not run: this batch changes transport validation,
not provider parsing, interception, ordering, Takeout or visual layout. The full
Tier 1 suite verifies the existing source-capture and export paths offline.

## Validation results

- `npm run type-check`: native TS7 passed.
- `node scripts/check-domain-trust-lint.cjs`: passed, including Content.
- `node -r ./tests/ts_register.js --test tests/live_save_coordinator.test.ts`: 11 passed.
- `node -r ./tests/ts_register.js --test tests/browser_runtime_v2.test.ts`: 41 passed.
- `npm test`: passed outside the macOS sandbox (Chromium launch requires it);
  369 unit test files, build and bundled-font gate passed; Playwright reported
  168 passed and 1 skipped by the existing suite.
- `npm run lint`: no Content warnings; warnings remain outside this batch.
- `git diff --check`: passed; `manifest.json` unchanged.
