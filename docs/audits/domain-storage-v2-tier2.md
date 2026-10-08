# Domain storage v2 acceptance

Verified on 2026-10-07 Pacific (2026-10-08 UTC), Chrome 155, debug port 9222.
Implementation commit: `3ef16214ee1c240384ab37a1f5b08166561147ac`.

## Final gates

- Tier 1: `npm test`, 237 unit suites, strict types/zero-any/build and 52 browser specs passed.
- Tier 2: full default scenario pool, 24 PASS / 0 FAIL / 0 SKIP / 0 WARN.
- Eight conversations exported and physically checked in Markdown, HTML and PDF.
- Actual multi-turn prompts/replies and generated/uploaded resource files passed the existing physical export assertions.
- Scenario pool restored to 20 with four fresh topics across the two attempted runs.

## Actual extension IndexedDB audit

Immediately after the final combined Markdown export, before the required uninstall stage:

| Check | Result |
| --- | --- |
| Application schema / Domain contract | 2 / 1 |
| Current conversations / revisions | 11 / 22 |
| Strictly validated current + history records | 33 |
| Stored messages / semantic assets | 68 / 14 |
| Account scopes | u0 only |
| Durable online acquired resources | 12 |
| Cached resource bytes | 2,825,031 |
| Removed conversation markers | 1 |

All envelopes and semantic graphs were validated. The actual deleted ephemeral conversation was absent, and removed markers did not coexist with restored current bodies. The audit returned aggregate counts, not private conversation bodies. This live RPC sample supplied no message model labels; explicit model preservation is covered by unit, legacy disk migration and cross-origin DOM browser tests.

The live Takeout fixture exposed no source-bound archived byte resources in the selected current records. Archive byte durability is proven separately by actual IndexedDB/reload/offline acquisition browser tests; the live cache counts above are online acquired bytes. Real v0/v1 upgrade, ambiguous account ownership, retry and quota-abort behavior are covered by the dedicated upgrade contracts/browser tests. The full live runner reinstalls the extension, so it verifies integration from a fresh installation rather than replacing those upgrade tests.

## Issues fixed and unsuccessful attempt

- A delayed page startup synchronization could recreate a remotely deleted conversation. Confirmed-deletion suppression and durable migration deletion markers prevent stale page/migration resurrection.
- RPC interception uses the historical Gemini account alias `default`. It is normalized to `u0` at the storage identity boundary; other providers' account IDs remain opaque. Unit and extension browser regressions cover writing via the alias and reading via the workbench scope.
- The first audit script accidentally created an empty database before the baseline export. Its empty test artifact was removed, the audit was changed to verify existence before opening, and the full live suite was rerun. That unsuccessful run is not accepted: it had 21 PASS, 1 FAIL, 2 dependent SKIP. Its baseline export failure explains the later missing updated badge.
- One Tier 1 browser teardown timed out; the isolated spec and subsequent full gate passed. No assertions, stages or skip flags were weakened.

Local evidence: `/Users/cui/Documents/GeminiExporterTests/storage-v2-2026-10-07/` contains the final ZIPs/extracted exports, full logs, aggregate storage audit and build hashes. The unsuccessful run log is labeled separately. Generated/physical test exports remain local and are not committed.
