# Joint closeout after #905, #906, and #907

Baseline: `47583a0aea755fefd19f94a700fc26d31a783437` (merged #907). Its main push CI [38482651505](https://github.com/OTLFrostA/gemini-exporter/actions/runs/38482651505) completed successfully before this work. The unchanged baseline passed `npm test`, including all 94 Playwright cases.

## Upgrade harness findings and fixes

The old global JSON lookup accepted a body found in an unrelated backup. Retention now binds normalized conversation ID and account slot to the current `gemini_exporter_domain/conversations` record, including its storage key, identity, versions, and conversation identity. It compares migrated messages/assets using the existing legacy parser and Domain disk recovery validator. No production schema is copied or changed. If the snapshot predates Domain storage, only the corresponding effective legacy list/detail location qualifies. Unscoped legacy details cannot be assigned to multiple accounts; inline account-specific bodies can legitimately share an ID.

Offline failures must identify exactly the requested conversations, without duplicates or unrelated IDs, and use concrete body-unavailable or disconnected-fetch reasons. The ZIP report and UI branch share the same validator. UI evidence additionally matches the real DialogView failure model against rendered row tooltips. A matching error-message prefix alone is insufficient; timeout, ZIP, schema, harness, and missing-tab errors fail the stage. Existing export records must remain identical.

The first stricter official-package run failed correctly: after restart, the harness had no Gemini tab and previously accepted “please open Gemini” as evidence of unavailable bodies. The corrected setup loads only the account page shell while all body/resource requests remain disconnected. The untouched official 1.7.0 baseline is never seeded.

Positive/negative guards cover valid legacy retention and Domain migration, wrong account/conversation/key/identity, missing current store, backup-only retention, body/byte corruption, ambiguous unscoped ownership, exact offline ID/reason lists, duplicate/missing/unrelated IDs, and unrelated exceptions. They run through the existing `test_tier2_assertions_suite` in `npm test`.

## Downstream contract audit

| Input / output | Conclusion |
| --- | --- |
| Batch export's TrustedDomain | Already trusted upstream. Completion needs only title/count/time/status metadata; it should not expose `any` or assert fresh Domain trust. |
| ExportCompletion | Uses an independent structural `ExportCompletionFacts` contract, retaining count-only containers and primitive compatibility. The output record is closed; the asset-failure mutator names only fields it changes. |
| LiveSave's `convInStore` | Deferred raw legacy boundary: `getConversations()` returns `StoredConversationRow[]`, including primitives and incompatible historical fields. It is not TrustedDomain or a validated metadata DTO. |
| PDF conversations / directory handle / delivered record | Known contracts reused from PreparePdfItemContext and WriterFactoryOptions, with an explicit PDF record matching existing ZIP/directory fields. Null/undefined directory failure paths and delivery callback timing remain unchanged. |
| IListView | Independent explicit callback signature; shared UI types no longer reference the concrete ListView implementation. |

LiveSave's raw `convInStore` and incoming transport payload remain uncertain legacy inputs, not justified `any` downstream of TrustedDomain. Removing them safely requires a separate metadata projection design: define handling of primitive rows, malformed IDs, titles, timestamps, and merge precedence, then test that supported legacy behavior is preserved. Today a null row can throw inside the list lookup and its catch leaves the stored metadata unset; silently adding a row guard would change that lookup behavior. This PR does not guess a new policy, add repeated Schema/Closure validation, or cast raw storage into TrustedDomain.

Production runtime changes are limited to two object checks in completion that preserve primitive compatibility. `behavior-summary.json` records 78 before/after comparisons of completion/count/time results against the baseline implementation. PDF, shared UI, and timestamp-helper type changes emit byte-identical esbuild JavaScript. Regression cases exercise primitive and count-only inputs.

Global lint warnings decrease from 1532 to 1487 (-45), with zero errors and no rule/file increases. Completion decreases 40 to 0; PDF decreases 18 to 13. `lint-summary.json` retains aggregate changes; full raw lint snapshots are intentionally not added. Remaining dynamic module, raw storage/transport, timer/listener, and parser compatibility seams are outside this closeout.

## Validation evidence

- `npm run type-check`: PASS.
- Upgrade harness guards: 5 Python tests PASS, including their Node positive/negative fixtures.
- Completion regression suite and 78 before/after behavioral comparisons: PASS.
- First candidate full run: 93/94 Playwright PASS; one first-scan completion poll timed out after 5 seconds. The unchanged main baseline passed that case, and three isolated reruns passed. The failed run is retained in the local audit log; no synchronization assertions or production scan rules were changed.
- Final `npm test`: PASS, including all unit/harness guards and 94/94 Playwright cases (the first-scan case also passed).
- Official 1.7.0 to candidate 1.8.1 physical-profile upgrade: `passed_with_na` (4 PASS, 1 NA). All six unavailable conversations across u0/u1 report exactly `fetch failed: Failed to fetch`, and both original export-record maps remain unchanged. HTML/PDF complete-content checks and failure/no-record checks PASS. The old profile persisted zero bodies and zero byte records; no offline recovery success is claimed.
- Reproducible package identity: official old SHA-256 `b79ed42a1dc080094fd78ca991f69d1a04f5b7e19fe3c20f45a5aec57b0f83cf`; candidate SHA-256 `8e108072b00e7c0657e3efa5ebf390753f85ec2071f755808c26e05e4f7677b3`.
- Local logs: `/tmp/joint-baseline-test.log`, `/tmp/joint-final-test.log` (first failed candidate run), `/tmp/joint-final-confirmed-test.log`, `/tmp/joint-incremental-recheck.log`, and `/tmp/joint-closeout-upgrade-20261013-confirmed/report.json`. The failing stricter upgrade run is preserved separately at `/tmp/joint-closeout-upgrade-20261013/report.json`.

