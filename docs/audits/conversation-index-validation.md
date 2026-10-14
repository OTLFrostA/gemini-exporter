# Conversation index migration validation

Validated on 2026-10-14. The index migration is delivered for review as a draft. Full live acceptance has **not** passed, and merging remains blocked pending that acceptance.

## Storage version correction

Storage v2 has not shipped; released users have v1. Body and index migrations are
therefore one v1-to-v2 startup upgrade, with the v2 stamp withheld until both complete.
The initial draft incorrectly advanced the application schema to v3; that increment
and the corresponding backup/report names have been corrected before release.
The historical evidence directory below retains its original name. The live evidence
below predates this version correction; Tier 2 has not been rerun for this revision.

## Completed checks

- `npm test` rerun after the storage-version correction: scoped zero-any, strict TypeScript, Python contracts, 267 Node unit suites, production build and 96 Playwright tests passed.
- Physical IndexedDB/reload tests verify original index backups, body separation, malformed-row reporting, pure reads, schema rejection and deletion retry.
- Negative type contracts reject historical aliases, title maps, bodies, nullable activity and identity-changing patches.
- The final default-pool live run passed real multi-turn creation and activity synchronization, natural passive Coverage, exhaustive/incremental pagination, cloud deletion with local archive retention, Takeout import and 4/4 authoritative title upgrades, continued-chat ordering, generated images and stale-tab image export.
- The scenario pool was replenished to 20 after consuming four scenarios across two runs that reached chat generation.

## Unsuccessful live acceptance

The latest full Tier 2 attempt finished with **15 PASS / 6 FAIL / 3 dependent SKIP / 0 WARN**. These results do not satisfy the full acceptance gate.

- Fast-skip preparation ran before the combined export and found three exported records where the test requires six. This scheduler/export-test code is unchanged by the index migration.
- The OFDM webpage evidence includes a Canvas/document execution error widget (`Something went wrong`). Its text differs from the physical Markdown, HTML and PDF exports, so the existing full-content assertions failed. The source/expected-content distinction needs a separate investigation; those assertions were not relaxed.
- The updated badge was absent after a later stale-tab export. Real ordering and authored timestamps passed. An intervening export refreshing the baseline is a possible test-order cause, not yet established as a complete diagnosis.
- The final combined selection found two targets rather than the required six, preventing the golden multimodal archive check and uninstall stage from running.
- An earlier run also exposed replacement of U+2714 in a PDF code block. The PDF renderer is unchanged by this migration.

The first activity assertion failure was a test-contract migration issue: the collector emitted `updatedAt` while the assertion still read `timestamp`. The assertion and its negative tests now use the canonical field. Replaying the frozen evidence passes, and real activity synchronization passed in the subsequent complete attempt. Natural passive sync initially exposed Google's current expanded recent-list request; exact protocol support and negative variants were added before the later attempts.

## Evidence and scope

Local logs and physical archives are preserved in `/Users/cui/Documents/GeminiExporterTests/conversation-index-v3-2026-10-14/`. Runner output directories may retain older artifacts; the individual logs and timestamps distinguish attempts. Private chat bodies and generated exports are not committed.

This phase establishes strict canonical index metadata and physical index/detail separation. The aggregate gateway exposing index with optional detail remains the next phase. Full Tier 2 acceptance is required before merging under the project workflow.
