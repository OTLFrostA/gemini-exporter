# W2-01 parser contract foundation

Baseline: `003f035` (W1 closeout #763). Scope is parser dependency/output
contracts only; W2-02 pagination, Provider contracts and permanent gate
integration remain separate tasks.

## Contracts available to W2-02

Import `ListParseResult`, `ConversationListItem`, `ListParseDiagnostics`,
`DetailParseResult`, `DetailParseDiagnostics`, `ParserMessage` and
`ParserDocument` as types from `src/core/api/geminiParser.ts`.
`ParserAttachment` is available from `parser/parseDetail.ts`.

- List provenance is `rpc | default`; detail provenance reuses
  `TitleResult['source']` (`rpc | sniff | default`). Existing ID/title/URL,
  count, nullable timestamps, cursor, drift/rejected-turn and truncation
  metadata remain intact.
- `_raw` is `unknown`, not a validated JSPB tuple or domain object.
- List diagnostics name the two existing failure reasons and carry nullable
  Bard error evidence, text length and raw/top previews. Detail diagnostics
  retain empty-result previews and optional schema drift warnings; `_debug`
  can still be null/absent.
- `ParserMessage` reuses the existing message contract while explicitly
  replacing its broad document/citation arrays with parser-assembled
  `ParserDocument[]` and `Citation[]`. Images retain `ImageAttachment`
  evidence; attachments reuse `Attachment` with the actual parser fields.
  Structured content reuses the existing decoder's `GeminiStructuredDocument`
  output; this does not strengthen its partial wire validation.
- Facade methods reuse attachment/extractor module method types, including
  images, files, doc sections, titles, citations and the visitor signature.
  The legacy unused `parseDetail` overrides parameter accepts `unknown`.
- Protocol/schema getters reuse `GeminiProtocolModule` and
  `typeof GEMINI_JSPB_SCHEMA`; utils getters reuse `GeminiUtilsModule`, with
  detail restricted to `Pick<GeminiUtilsModule, 'isDevMode'>`. The existing
  module override mechanism remains unchanged.

## Runtime preservation

No wire discovery, turn/candidate recognition, timestamp/cursor precedence,
attachment/document heuristic or structured decoder condition was changed.
All 19 W1 characterization assertions retain their original expected values;
only erased non-null assertions were added for optional diagnostics.
P-01 through P-05 remain unchanged, including rejected-turn message emission,
ID-only candidate fallback, permissive user-file fallback, title precedence
and null-user drift warnings.

The only runtime-source change is catch error narrowing. Known `Error` values
are narrowed normally. Non-Error values retain an explicitly unvalidated
`{ message?: unknown }` diagnostic projection and the original property-read
semantics, including null/undefined TypeErrors; they are not converted to a
fake `Error` or stringified differently. Regression tests cover Error,
object/string/numeric-message throws and null/undefined for both parsers.

Emission verification used esbuild `transformSync` with loader `ts`, target
`chrome120`, format `esm`, syntax/whitespace minification and unchanged
identifiers. Against `003f035`, facade and extractors emitted identically;
list/detail emitted identically after restoring only the intentional catch
narrowing to the original error-property expression. This is evidence for
parser-path preservation, not a claim that the complete change is type-only.
Tier 2 is therefore also executed.

## Zero-any status and deliberately deferred boundaries

`geminiParser.ts` and `parseList.ts` pass a whole-file explicit-any lint check.
This is not proof of deep wire validation: library `Array.isArray` narrowing
and `payload.ts` still allow unvalidated list-row/index values internally.
No permanent lint scope or package script is changed; W2-08 owns integration.

Remaining explicit escapes (symbols are stable; line numbers may move):

| File | Deferred hotspots |
|---|---|
| `parseDetail.ts` | `TurnsExtractionResult.turns/inner`; `extractTurnsFromInner` input, working turns and metadata `rc_count` callback; `buildUserMessage` raw turn/request-ID scan; `parseCandidateResponse` raw candidate/turn/inner and fallback turn-ID scan. |
| `extractors.ts` | `extractCandidateText` BODY slot projection; `extractGroundingCitationMarkers` field 44 projection; `extractConversationTitle` nested prompt projection. JSON decoding and library-narrowed tuples remain partially validated. Internal debug flags now use unknown-valued flag projections, not broad any. |
| `payload.ts` (unchanged) | `InnerPayloadDiscoveryResult.inner`, working `inner`, JSON decoding and WRB/slot probes. |
| `attachments.ts` (unchanged) | `ImageNodeDetector`, type-36 object probes, matched document evidence and `contentMatch` property projection. |
| `structuredContent.ts` (unchanged) | Seven double assertions to structured nodes, list/table arrays, and pre-attached candidate/turn structured-content projections. |

`extractTurnRequestId` now accepts `unknown`; its existing optional index read
uses a documented parser-local unknown-valued indexable projection. This does
not claim the input has been validated as a turn. Existing module-override
and shared domain `Message` escapes outside this scope remain unchanged.

## Validation

Tier 1 and focused results: Initial
sandboxed browser checks failed to launch Chrome (EPERM); browser checks were
rerun with the permitted local browser environment, without skipping stages.

The live run consumed two scenarios. Per AGENTS.md, they were replaced through
`manage_scenario_pool.py topup` by new urban stormwater/Imagen and low-resource
linguistics scenarios. Effective pool validation returns 20/20.

| Command | Result |
|---|---|
| `npm run type-check` | PASS |
| `python3 tests/run_tests.py --filter parser_boundary_characterization` | PASS: 19 unchanged characterizations |
| `python3 tests/run_tests.py --filter parser` | PASS: 8 parser suites |
| `python3 tests/run_tests.py --filter parser_contract` | PASS: compile-time contract checks and both parser error regressions |
| `npm run test:corpus` | PASS: 110 documents, 60 math expressions; no diagnostics or WASM failures |
| `npm run provenance:summary` | PASS: existing 23 suites / 217 tests; no new live provenance claim |
| `npm run test:changed` | PASS: 97 affected unit suites and affected E2E specs |
| `CI=1 npm test` | PASS: 200 unit suites, build, 43 E2E tests; existing CI retry configuration used |
| Whole-file explicit-any check of facade/list | PASS; permanent gate unchanged |
| `npm run pool:status` / `npm run pool:validate` | PASS: 20/20 after each two-scenario consumption |

Two unsandboxed plain `npm test` attempts had different one-off UI readiness
failures (export list item, then onboarding step). The export suite passed
3/3 on focused retry; the final full CI-mode run passed all 43 E2E tests.
The initial sandboxed full/incremental runs could not launch Chrome (EPERM).

First `npm run test:live` result: **FAIL**, 18/24 passed, 1 failed and 5
blocked automatically by the DAG. The downloaded ZIP was physically
extracted. The fresh Imagen conversation exported a second empty model
header after its image-bearing reply, violating role alternation. The
failure is in `分子云冷核表面加氢动力学_274e6d.md`, line 494, following the
model reply at line 482. A follow-up batchexecute read captured the same test conversation
raw detail. Both the baseline `003f035` parser bundle and current bundle
parsed an identical reconstructed WRB envelope. Their complete results
were deep-equal: 15 messages, with the duplicate model at zero-based
index 6 (one-character content, no attachments or structured content).
This directly reproduces the failure on baseline, in addition to the
emission comparison. No parser condition/message assembly in that path
changed. This is a semantic integration
finding for W2-08/separate behavior work, not silently corrected in W2-01.
Live continuation/promotion, ephemeral deletion, Takeout import, full scan,
4/4 title upgrades and both live disk-write scenarios passed.

The second complete pool-mode run wrote to `tests/output/live_export_retry`;
its final result is **PASS: 24/24, zero failures/skips/warnings**. It preserves the first
run's ZIP, extracted files and log. Its consumed scenarios were replenished
with new paleobiology/Imagen and randomized numerical-linear-algebra topics,
again using the pool manager. No stage skip flags are used.

Final Tier 2 command:
`npm run test:live -- --output-dir tests/output/live_export_retry`.
All 24 registered features executed and passed. The extracted ZIP validated
8 Markdown conversations, both fresh scenarios' complete prompt/reply
content, index/frontmatter/media syntax, physical images and uploaded-file
SHA256. HTML and PDF each produced 8 valid physical documents; stale-tab
image export also passed. No stage was bypassed. The first run's semantic
finding remains in the report even though the complete rerun passed.

Tier 3 was not assigned or triggered by this contract-only parser task;
no visual-subagent pass is claimed. This work does not implement W2-02 or
W2-03 and does not extend the permanent zero-any gate.
