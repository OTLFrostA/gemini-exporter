# Conversation index migration validation

Validated on 2026-10-14. The index migration is delivered for review as a draft. Full live acceptance has **not** passed, and merging remains blocked pending that acceptance.

## Storage version correction

Storage v2 has not shipped; released users have v1. Body and index migrations are
therefore one v1-to-v2 startup upgrade, with the v2 stamp withheld until both complete.
The initial draft incorrectly advanced the application schema to v3; that increment
and the corresponding backup/report names have been corrected before release.
The historical evidence directory below retains its original name. Historical live evidence is separated from the current attempts below.

## Review corrections

- Native import is a partial upsert under the conversation lock, preserving unrelated
  indexes and stronger existing metadata. Empty imports cannot erase the list.
- Authoritative list presence can restore deleted cloud availability. Requests begun
  before a same-context deletion and cached/body observations cannot restore it;
  failed storage commits retain the deletion fence.
- Native RPC acquisition resolves transient `sourceVersion` from matching batched List metadata; Detail has no `updatedAt`;
  message maxima do not establish the source version. Index sorting and export freshness
  use the same source activity semantics. `lastMessageAt` was removed.
- `savedAt` records the selected nonpartial body's source version, never local clock time.
  Partial/unversioned/migrated bodies omit it. Export baselines come from the exported
  body, and local `exportedAt` cannot suppress later source activity.
- Regression coverage includes concurrent imports, fresh/stale/failed cloud recovery,
  source version alignment and physical IndexedDB reload.
- A separate read-only live audit compared six conversations: List metadata, batched
  metadata and latest detail turn timestamps were identical, including wire nanoseconds.
  See [the time audit](conversation-time-semantics.md). This is not a full Tier 2 pass.

## Timestamp alignment validation

- Full `npm test` passed: scoped zero-any, strict TypeScript, Python contracts,
  **268 unit suites**, production build and **98/98 Playwright checks**.
- The final TypeScript rerun and the 19-case PDF suite also passed after adding
  direct-file and ZIP saved-version assertions.
- The physical repository/reload suite passed 15/15, including saved-version advancement
  without body changes, preservation behind a newer Index, rejected partial captures,
  and absence of `updatedAt` inside stored Detail.
- Seven source-version tests cover anonymized live wire replay, unknown/partial/migrated
  versions, pagination consistency, local clock skew and JSON archive metadata.
- Strict TypeScript checks reject `updatedAt`, `savedAt` and acquisition `sourceVersion`
  inside Detail. The canonical activity field remains Index `updatedAt`.

## Current live attempts

### Isolated final-build rerun

A fresh full 24-feature run after fixing extension-page discovery completed with
**14 PASS / 3 FAIL / 7 dependent SKIP / 0 WARN**, exit 1. The runner uninstalled the
main-checkout extension and installed this worktree's build. The generation-time
snapshot contained only the expected extension origin. Options and Popup discovery
now require the selected extension's exact origin and page path; foreign pages,
URL substrings and unknown extension IDs cannot provide fallback pages. Thirteen
environment unit checks and the full `npm test` gate (268 suites, 98 Playwright
checks) passed with this harness change.

- Natural passive Coverage passed. The pre-chat scan exhausted nine pages and 361
  conversations. The current worktree already supports the expanded ten-element
  recent-list request; no additional protocol relaxation was made in this rerun.
- Cloud deletion with local archive retention, Takeout import, exhaustive/incremental
  sync and 4/4 authoritative title upgrades passed. The earlier foreign-extension
  storage-contract error did not recur.
- Chat generation failed on conversation one's second turn after 300 seconds. The
  prompt asks for equations and an explanation of the existing **illustration**;
  `GeminiChatSession.send_turn` classifies that word as an image request. The captured
  state shows 7,816 reply characters, no Stop or streaming DOM, a ready editor, zero
  new image elements and no completion event. With `require_image=True`, the text
  stability fallback is unavailable. This explains the observed timeout path; why
  the network completion event was absent remains unverified.
- Fast-skip ran before the combined export and failed its setup requirement with
  zero exported records. Its empty prerequisite list still permits this ordering.
- PDF ZIP did not appear within 90 seconds. The final Options log contains HTML
  and Markdown export starts but no PDF export start or compiler error. The helper
  silently does nothing when the export button is disabled; a readiness/trigger race
  is a candidate requiring separate verification, not an established compiler fault.
- HTML ZIP (five files) and Markdown ZIP (six conversations) were physically saved
  and extracted. Their content/specification checks cover existing/Takeout targets;
  both reported **zero new scenario turns** because generation failed before a
  complete record was registered. These passes do not establish full multimodal or
  live-content acceptance. Seven dependent stages, including continued-chat ordering
  and live saving, were skipped by the DAG. Full Tier 2 acceptance remains blocked.

The isolated run's logs, snapshots and physical archives are in
`/Users/cui/Documents/GeminiExporterTests/conversation-time-alignment-2026-10-14/tier2-isolated-rerun/`.
The consumed mechanism and rollback-union-find scenarios were replaced with reservoir
mass conservation and barycentric interpolation scenarios; the pool validates at 20.

### Follow-up investigation and Medium default

At the user's request, Tier 2 now selects **3.8 Flash + Medium** instead of High.
The driver verifies the selected menu item after switching and rejects a missing
Medium option or a selection that does not stick. Fourteen driver unit checks pass,
and the real Gemini menu was switched and verified without sending another prompt.
Full `npm test` also passed after this change: 268 unit suites, production build
and 98/98 Playwright checks, along with zero-any, strict typing and Python gates.
The 14/3/7 result above was obtained with High; it is not a full Medium rerun or a
High-versus-Medium latency comparison. Lowering thinking does not fix the completed
text reply being classified as another image request.

The fast-skip feature checks that already-exported, unchanged conversations are
excluded quickly and that a mixed batch exports only its unexported target. Its
setup requires six exported badges, but it has no DAG prerequisites. In the recorded
run it executed before any export and failed setup at zero badges, so the product's
skip behavior was not reached.

PDF investigation used the original HTML/PDF case implementations against the same
five historical/Takeout targets. A recorded replay passed five physical PDFs in
5.48 seconds (609,025-byte ZIP), with no page errors. Three further uninjected
HTML-to-PDF sequences also produced PDF archives. The compiler failure did not recur.
A separate controlled post-export-refresh timing probe reproduced no PDF start and
no PDF download while the next trigger observed a disabled export button with five
targets selected. The helper's `if (btn && !btn.disabled) btn.click()` silently skips
the click but still waits for a ZIP. Download completion can precede export cleanup;
page readiness and actual task start need explicit evidence. The original failing
run lacks that click-time snapshot, so this reproducible failure mode remains a
candidate explanation for that run, not a conclusively attributed root cause. The
outer export mutex can also outlive the controller's button unlock during list
refresh; its involvement in the original run was not established.

These diagnostic replays do not generate new chats and do not replace full Tier 2
acceptance. Logs, click states and physical ZIPs are preserved in
`/Users/cui/Documents/GeminiExporterTests/conversation-time-alignment-2026-10-14/pdf-trigger-investigation/`.

### Earlier attempts

The completed timestamp-alignment attempt **before removal of Detail `updatedAt`**
finished **18 PASS / 3 FAIL / 3 dependent SKIP / 0 WARN**. Markdown, HTML and PDF physical
content assertions passed in this run. The remaining failures were the updated badge,
combined selection (2 instead of required 6), and fast-skip preparation (3 instead of 6).
The three dependency skips were live incremental-disk checking, golden combined export
assertions and uninstall. These are not a complete acceptance pass.

The first attempt after field removal ended during generation without a summary.
The final-build retry was also interrupted: the debug Chrome session on port 9222 no
longer contained the expected worktree extension `ggckhnmcnjpkbalkbjopmfkphbikialk`;
its options pages and service worker belonged to `nnpkepcmgklclaaamekolngbgdjindck`.
The runner was stopped after saving this identity mismatch. This is an environment
blocker, not evidence for or against the final implementation. No final Tier 2 pass
is claimed, and the PR remains draft.

The pool was replenished to 20 after each consumption. Current private logs, timestamp
responses and the extension-identity observation are preserved separately in
`/Users/cui/Documents/GeminiExporterTests/conversation-time-alignment-2026-10-14/`.

## Historical migration validation (before timestamp alignment)

### Historical completed checks

- `npm test` rerun after the storage-version and review corrections: scoped zero-any, strict TypeScript, Python contracts, 267 Node unit suites, production build and 97 Playwright tests passed.
- Physical IndexedDB/reload tests verify original index backups, body separation, malformed-row reporting, pure reads, schema rejection and deletion retry.
- Negative type contracts reject historical aliases, title maps, bodies, nullable activity and identity-changing patches.
- The final default-pool live run passed real multi-turn creation and activity synchronization, natural passive Coverage, exhaustive/incremental pagination, cloud deletion with local archive retention, Takeout import and 4/4 authoritative title upgrades, continued-chat ordering, generated images and stale-tab image export.
- The scenario pool was replenished to 20 after consuming four scenarios across two runs that reached chat generation.

### Historical unsuccessful live acceptance

The earlier migration Tier 2 attempt finished with **15 PASS / 6 FAIL / 3 dependent SKIP / 0 WARN**. These results do not satisfy the full acceptance gate.

- Fast-skip preparation ran before the combined export and found three exported records where the test requires six. This scheduler/export-test code is unchanged by the index migration.
- The OFDM webpage evidence includes a Canvas/document execution error widget (`Something went wrong`). Its text differs from the physical Markdown, HTML and PDF exports, so the existing full-content assertions failed. The source/expected-content distinction needs a separate investigation; those assertions were not relaxed.
- The updated badge was absent after a later stale-tab export. Real ordering and authored timestamps passed. An intervening export refreshing the baseline is a possible test-order cause, not yet established as a complete diagnosis.
- The final combined selection found two targets rather than the required six, preventing the golden multimodal archive check and uninstall stage from running.
- An earlier run also exposed replacement of U+2714 in a PDF code block. The PDF renderer is unchanged by this migration.

The first activity assertion failure was a test-contract migration issue: the collector emitted `updatedAt` while the assertion still read `timestamp`. The assertion and its negative tests now use the canonical field. Replaying the frozen evidence passes, and real activity synchronization passed in the subsequent complete attempt. Natural passive sync initially exposed Google's current expanded recent-list request; exact protocol support and negative variants were added before the later attempts.

## Evidence and scope

Local logs and physical archives are preserved in `/Users/cui/Documents/GeminiExporterTests/conversation-index-v3-2026-10-14/`. Runner output directories may retain older artifacts; the individual logs and timestamps distinguish attempts. Private chat bodies and generated exports are not committed.

This phase establishes strict canonical index metadata and physical index/detail separation. The aggregate gateway exposing index with optional detail remains the next phase. Full Tier 2 acceptance is required before merging under the project workflow.
