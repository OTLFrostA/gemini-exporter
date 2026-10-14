# Minimal Domain/export contract fixes

Three fixes use existing representations and flows:

- Composer assigns each Document message `msg-${index}` in source array order. Repeated, absent, empty or colliding authored message IDs no longer abort HTML, Markdown or PDF preparation. Source Domain IDs, message bodies, order and counts remain unchanged. Citation IDs are namespaced by the unique Document message ID. The message-ID set and rejection branches are removed; PDF reference payload changes only its two display IDs.
- Gemini DOM parsing directly marks coverage `partial`. The existing completion/parse-drift path emits partial status even with no resource failures. Regression coverage verifies this survives JSON restoration and remains eligible for Skip Exported retries. Other parsers' unknown coverage behavior is unchanged. Storage permits partial captures to fill empty metadata placeholders; its existing protection of nonempty nonpartial bodies remains.
- Storage excludes explicit placeholder candidates before applying existing source ranks. The existing placeholder predicate now also recognizes the exact generic labels already listed by `isRealTitle` (New chat, Untitled and related labels). No title-quality score, short-title rejection or Takeout prompt-prefix filtering is added. A better body can be stored while the real old title survives; a real lower-ranked title can replace an old placeholder while preserving the fuller old body. Normal source ranking is unchanged.

No new helper, wrapper, fallback, status field or compatibility layer. Domain/Storage versions and released v1 migration are unchanged. Production diff: +6 / -9 lines, net -3.

Validation:

- Focused regression and PDF parity follow-up: PASS, including all three broad-suite failures caused by obsolete display-ID expectations.
- Full `npm test`: PASS on the final code: type-check, zero-any, Python harness/architecture checks, all 266 unit suite files, production build, 95/95 Playwright (0 skipped).
- Oxlint: 1478 warnings, 0 errors, unchanged baseline. No suppressions or configuration changes.
- Supplemental ESLint structural audit: PASS, 0 errors / 0 warnings.
- Scenario pool: 20/20.
- Tier 2: NOT RUN; no logged-in debug Chrome is available at localhost:9222. No live account result is claimed.

Presentation IDs intentionally change to positional IDs for all composed messages; exported bodies remain intact. DOM exports intentionally remain partial/retryable even when the visible fragment happens to include the whole conversation, because DOM alone cannot establish full coverage. Existing persisted Domain records remain readable without migration.
