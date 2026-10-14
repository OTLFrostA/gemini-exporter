# PR #927 review fixes

This follow-up changes only the four reviewed concerns. Deleted Domain fields remain deleted; message generation, asset identity, report Markdown, `hasFabricatedText`, existing resource results and released 1.7 → Storage v2 migration remain intact. Storage and Domain versions remain 2.

- **P2-1 — Hygiene:** Restore `generation?: Partial<DomainGeneratedMediaIdentity>` and ordinary optional document fields. Remove both parser assertions and the two compile-time empty-object rejection tests. The existing runtime nonempty checks and regression tests remain.
- **P2-2 — Bug fix:** Only HTTP(S) and data references are exempt from missing archive resource failures. Unresolved `blob:`, `file:` and custom scheme references now produce existing ResourceFailure results and partial import status, agreeing with parser diagnostics. The Takeout resolver itself is unchanged.
- **P3-1 — Hygiene:** `TitleCandidate.source` is `TitleSource`. The existing source collection becomes a typed lookup map, allowing the legacy parser to normalize raw strings through `get()` without assertions or a conversion helper. Trusted storage uses its typed source directly. Title ranks and tie-breaking remain unchanged; there are no new graph traversals.
- **P3-2 — Confirmed limitation:** The sole shared resource producer filters undefined generation values, conditionally adds defined document fields and omits empty metadata objects. RPC additions attach a defined request ID. Takeout generation includes an ordinal. Regression coverage includes undefined source fields and verifies JSON restoration. Direct caller input such as `{ generation: { prompt: undefined } }` can still pass the parser boundary but fail snapshot restoration after JSON removes the key. This known limitation is retained as requested, without another validator, recursive checks or schema layer.

No helpers, wrappers, fallback paths, compatibility layers or state fields were added. All four assertions introduced by PR #927 are removed; existing unrelated assertions remain. Production diff: **20 added / 20 deleted lines**, net zero.

Validation:

- Targeted Domain, title authority and native caller tests: 38 passed, including undefined-field omission and JSON restoration.
- Full `npm test`: PASS. Type-check, zero-any, Python harness/architecture checks, all 266 TypeScript unit suite files (including migration and HTML/Markdown/PDF), production build, and 95/95 Playwright tests passed (0 skipped).
- Oxlint: 1482 → **1478 warnings**, 0 errors; returns to the pre-#927 baseline of 1478. No lint suppression or configuration changes.
- Supplemental ESLint structural checks: PASS, 0 errors / 0 warnings (nine existing external audit rules; repository lint remains Oxlint).
- Scenario pool: 20/20.
- Tier 2: **NOT RUN**. The logged-in debug Chrome endpoint at localhost:9222 is unavailable. No live account test is claimed.

Normal supported import/export behavior is preserved. The intentional behavior change is that unresolved unsupported URI resources report partial import rather than success. Runtime resource acquisition still determines export failures after storage restoration; failures are not persisted on Domain assets.
