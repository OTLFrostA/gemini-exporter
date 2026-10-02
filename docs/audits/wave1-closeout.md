# Wave 1 closeout

This report supersedes the acceptance status in the historical
[W1-05 integration report](wave1-integration-report.md). It records the two
authorized closeout changes after #757–#761; it does not start Wave 2.

## Changes

- PR A: await the export operation in the existing async btnExport handler;
  align AGENTS.md's npm test definition with package.json; replace stale ongoing
  suite counts with current-full-suite wording; document actual title selection
  order and rank ties. Classify parser/provider findings in the
  [Wave 2 backlog](wave2-backlog.md).
- PR B: explicitly declare TitleSources.openai; include openai in the existing
  authoritative title-slot guard. A regression covers old-title and incoming-title
  fallback plus already-provenanced OpenAI titles; it fails before the guard fix
  by observing an unwanted legacy slot and passes after it. Keep the existing
  no-authoritative-slot legacy fallback. Replace api-list in the provider fixture
  with rpc: it is a stale fixture value, not a historical compatibility test
  (production has no api-list source and title_source_completeness excludes it).

Title source selection remains `rpc > api-detail > dom > takeout > openai > sniff
> legacy > default`. Rank ties remain rpc/api-detail=50 and takeout/openai=30.
Only OpenAI legacy-slot fabrication changes; no title ranking is changed.
The protected zero-any scope remains exactly titleUtils.ts and mergeUtils.ts.

## Final acceptance results

All local Done conditions pass on the combined PR A + PR B state. W1 can be
formally closed after both PRs pass their server-side gates and are merged.

| Requirement | Result |
|---|---|
| npm run lint | PASS on final combined state |
| npm run lint:zero-any | PASS for PR A and PR B |
| npm run type-check | PASS for PR A and PR B |
| npm run test:changed | PASS for both; PR B covers 126 unit suites and 43 E2E cases |
| npm test | PASS for PR A and final combined state: 191 unit suites, build, 43 Playwright cases |
| Title/Merge and OpenAI guard characterization | PASS; guard regression reproduced before fix |
| Parser 19 characterization | PASS, focused suite unchanged |
| Provider characterization | PASS, four provider-filtered suites; fixture corrected |
| npm run test:corpus | PASS, 110 documents / 60 expressions, no diagnostics/fallbacks/compile failures |
| npm run provenance:summary | PASS, canonical/math manifest: 23 suites / 217 tests |
| npm run pool:status | PASS, 20/20, no scenarios consumed |
| Documentation and npm test command agree | PASS; scoped zero-any included |
| Parser/provider debt classified and deferred | PASS; five parser entries and ten provider entries |

No production parser or provider public contract is changed. All #759
characterizations remain unchanged. No provider API is designed or implemented
in closeout. The small title guard correction does not change parser, Takeout
import, ordering or interception behavior; no Tier 2/3-triggering change is made.

Known parser semantics are retained deliberately with BUG/NEEDS_EVIDENCE labels;
provider architecture work is deferred as WAVE2. These are explicit backlog
items, not unhandled W1 acceptance blockers. The first suggested Wave 2 task
remains typing current parser schema/protocol/facade dependencies and diagnostic
outputs, with existing characterizations unchanged.
