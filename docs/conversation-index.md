# ConversationIndex: title evidence, first implementation step

Contract: [L2 Domain｜ConversationIndex（部分定稿）](https://app.notion.com/p/3fb5d4d759e181c1abd9c0905c44c058), read on 2026-10-15. This step implements title provenance and admission policy; it does not claim the complete target storage schema is implemented.

## Implemented

- L2 retains the existing ranks: user 60; rpc/api-detail 50; dom 40; provider/takeout/openai 30; sniff 20; derived/legacy 10; default 0. Compatibility title resolution uses the same source union and includes every source, so presentation/export cannot demote user evidence to legacy.
- Gemini list titles come from the explicit row title field. A bundled list response may supply the requested Detail's title. Metadata-only detail responses use the existing list-row layout, selecting the requested conversation rather than an unrelated first row. Arbitrary strings in a detail response no longer become RPC title evidence; prompt-derived titles remain sniff evidence.
- Gemini DOM Index and Detail share one title extractor: explicit conversation title elements, then an exact same-provider conversation link, then a sniff fallback from the first query. Generic `h1` and `document.title` do not establish a conversation title.
- Takeout does not synthesize `Takeout conversation` when no usable prompt exists. An absent title stays empty/default while body and import facts survive. An actual prompt remains Takeout evidence at the existing rank.
- ChatGPT list and detail apply the same placeholder-title filtering. Its scaffold retains provider rank 30 and remains unregistered by default; no claim of verified live ChatGPT title protocol is made.
- Active-chat Sync may still seek better metadata for DOM/Takeout/provider/sniff/derived/legacy evidence. Its existing time-presence guard for user/RPC/API evidence is retained. This is an application acquisition decision; Domain does not fetch or declare a title finalized.

All current admission paths retain `mergeConversationIndex` as their L2 source-priority rule. Index-only writes do not replace, invalidate, or fetch saved Detail. Source activity times and title evidence remain independent.

## Deliberately unchanged

- Same-rank title replacement remains the existing arrival-based behavior; neither it nor compatibility timestamp tie-breaking is endorsed as the future freshness policy. No title version clock, finalized flag, or revision store is added.
- Earliest known creation/latest known activity merging remains unchanged. Activity does not prove title freshness or Detail completeness.
- `cloudAvailability`, `hasTakeoutImport`, and `messageCount` remain, pending their separate design review.

## Storage work still required by the target contract

This change does not alter global schema version 2. Current Index scope still uses legacy slots, Index still has `providerId` and optional persistent `url`, and Domain body records still embed an Index. The repository composes authoritative catalog metadata on its normal read path, but that does not remove the physical duplicate.

Account UUID + provider conversation ID addressing, removing persistent conversation URLs in favor of provider-generated links, and removing the nested Index must be implemented with the existing global migration entry point. That work must cover old slot ownership, all read/write consumers, export/coverage references, migration failure/retry behavior, and existing user data. It must not be presented as complete merely because the title evidence rules now agree.

## Validation

- Full `npm test` passed: scoped zero-any gate, TypeScript, the complete unit suite, production build, and all 107 Playwright tests.
- Seven archived native detail responses were reparsed with main (`c89293e8`) and this implementation: messages, assets, and quality were identical for all seven. Without accompanying list metadata, titles remain sniff/default evidence.
- A full 25-feature Tier 2 run loaded the final source bundle. Result: 16 PASS, 2 FAIL, 6 SKIP, 1 non-blocking dual-parse WARN. This is **not a passing Tier 2 result**.
- The first live conversation completed five rounds, but its initial physical Markdown export failed full-text comparison: the export included the generated-document label `Looped Pipe Network Hydraulics`, absent from the independent visible-reply evidence. Replaying that captured native payload on main and this branch produces identical ten-message bodies, assets, and quality; both contain the label. This title change does not resolve that existing export/evidence discrepancy.
- The initial failure prevented generation of the second planned conversation. Its missing Markdown caused the other FAIL, while six dependent features were SKIP. The passing features include Takeout-to-RPC title upgrades (4/4), full pagination (10 pages), cloud deletion with local retention, and physical HTML/PDF/image exports; they do not substitute for the incomplete full run. Assertions and prerequisite gates were retained.
- The scenario pool was replenished to 20/20 and validated. Raw captures and detailed local logs remain in git-ignored `tests/output/conversation_index_validation/` and `tests/output/conversation_index_live_retry/`.

Keep the PR unmerged while this live validation gap remains. Global storage migration is the next separately scoped implementation step.
