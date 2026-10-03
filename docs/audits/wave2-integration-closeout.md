# Wave 2 integration, contract gates and debt closeout (W2-08)

Baseline: `9e8bc03` (#771), clean main. W2-01–07 are already merged:
#764 parser outputs, #765 pagination contracts, #766/#767 neutral Provider and
registry correction, #768 explicit adapter, #769 sync consumer, #770 detail
transport, #771 nullable dependencies/namespace recheck. No conflict resolution,
new adapter, storage schema or architectural migration is needed.

## Final contract chain

`GeminiResponseParserFacade` preserves typed list/detail outputs and unknown raw
wire evidence. `PaginationResult` / `PaginatedDetailResult` aggregate those
outputs and carry explicit diagnostics/completeness. GeminiProvider maps declared
fields explicitly, preserving nested messages/media/evidence by identity.
Neutral registry/resolver expose `AIProvider | undefined`. Current content
readers retain the named `ApplicationProvider` Gemini assumption at four resolver
sites; this is not runtime capability validation or a neutral extension bag.
Sync consumes typed canonical items. Router's flat response discriminates RPC,
DOM, empty/deleted and failed results; live-save joins typed provider/injected/DOM
acquisition before existing downstream export processing.

Neutral item/detail fields remain id/title/url, number-or-null createdAt/updatedAt,
messageCount and message id/role/content/timestamp. Neutral list control retains
items/total/hasMore/nextCursor/stoppedEarly, required exhaustive/completionReason.
Readiness remains ready/accountName/error. Gemini companion preserves
accountSlot inputs, titleSource/titles, chatTime/timestamp aliases,
images/attachments/generated request identity, documents/citations/structured
content/thoughts/sources/grounding, raw/debug, schemaDrift/turnsRejected,
truncation/count/cursor and typed quota/page diagnostics. No evidence is moved
into canonical output or silently dropped.

## Required debt corrections

| Trigger | Final behavior | Safety regression |
|---|---|---|
| Negative maxPages | Zero requests, incomplete max_pages result; zero keeps its existing default budget | Direct pagination regression and actual producer → adapter → sync test: no reconciliation/checkpoint write |
| Empty/malformed NO_INNER_STR, or missing conversations array | Incomplete error; acquired data/debug retained; genuine empty page without failure evidence remains natural exhaustion | Empty first page, actual parseList output for empty/non-JSON/object/null payloads after partial data, plus adapter/sync no-prune tests |
| In-flight AbortError after partial data | Incomplete aborted result, partial items retained; observed cancellation takes precedence over limit classification | Direct AbortError regression plus actual adapter/sync no-prune test |

Reconciliation policy/compatibility guard are unchanged. Every unsafe aggregate
sets exhaustive=false and stoppedEarly=true; sync cannot infer completeness
from hasMore. Natural exhaustion, watermark stop, token loops, positive budget,
Google limits, ordinary errors and loop/pre-abort behavior retain their meanings.
First-page exceptions still reject; callback errors still reject. Error diagnostics
now use the existing typed getErrorMessage helper instead of projecting unknown
throws. No parser P-01–P-05 condition is edited.

Contract tests now use exact equality for parser result/facade/assembled fields,
pagination diagnostics/callbacks, and producer/client async results. Both helper
and GeminiAPIClient list/detail results are pinned with Awaited<ReturnType<...>>.
Resolver is pinned exactly to AIProvider | undefined; awaited sync exactly to
ProviderSyncResult | null. Assertions compare real function surfaces, not merely
named expected types or the outer Promise. No brittle source-text partial gate
is introduced.

Router syncEngine/scraper/assets now declare | null alongside storage/utils.
The direct compile-time fixture specifies all five null dependencies without
any, assertions or suppressions. Runtime routing is untouched.

## Sound opaque Provider inputs

Neutral readiness/detail inputs remain unknown. Gemini companion and implementation
also accept unknown, then read only string accountSlot/targetSid/slot properties
from object/function inputs. Valid strings retain accountSlot default u0 and
truthy targetSid > slot > null precedence; opaque primitives/null or invalid field
types use those defaults. Property getters remain observable as before.

Readiness/list/detail in both contracts are function-valued properties, so strict
function variance applies at the interface boundary. Compile-time gates pin actual
Gemini/companion parameter tuples to the neutral readiness/detail tuples and
assign bound implementation functions to rebuilt neutral call signatures.
Negative conditional regressions prove narrower string-option functions do not
satisfy the unknown-input function contract. These do not rely on method
bivariance or an extends-only test. Runtime neutral-call tests cover undefined,
null, number, string, symbol and invalid-field objects, plus valid slot precedence.
Known Gemini option/context record types remain available as input descriptions;
no cross-provider account/session schema is invented.

DOM images/attachments now use the existing general Attachment contract rather
than importing ParserAttachment. Their runtime image objects, alt text and
isGenerated flags are preserved. parseDoc overloads accept Document | null and
return null explicitly for null, while Document callers retain DomDetail.
Live-save forwards the nullable document without doc!; an any-free regression
checks unavailable provider + missing document returns null. Custom test scrapers
still receive null, preserving the injectable fallback seam.

## Permanent whole-file zero-any scope

`npm run lint:zero-any` remains the entrypoint. A small JSON manifest and Node
spawn runner call the existing oxlint rule with the existing no-ignore and
nested-config controls; missing files fail. No new lint framework is introduced.
The production scope is exactly these 14 files:

1. src/core/utils/titleUtils.ts
2. src/core/utils/mergeUtils.ts
3. src/core/api/geminiParser.ts
4. src/core/api/parser/parseList.ts
5. src/core/api/client/pagination.ts
6. src/core/provider/aiProvider.ts
7. src/core/provider/providerRegistry.ts
8. src/core/provider/providerResolver.ts
9. src/core/provider/index.ts
10. src/core/provider/gemini/geminiContracts.ts
11. src/core/provider/gemini/geminiProvider.ts
12. src/content/providerCompatibility.ts
13. src/types/detailTransport.ts
14. src/types/messages.ts

All were audited for explicit any/as any/arrays/Record/generics, double assertions,
and blanket lint/TS suppressions. None contains such an escape or suppression.
This whole-file explicit-any gate does not certify raw-wire validation: parseList
still inherits unvalidated payload/library-narrowed array elements and retains
its historical unknown-error projection. Global strict type-check runs the exact
contract fixtures even for consumer files outside the whole-file lint scope.

Unit Tests & Syntax already runs lint:zero-any and type-check; that invocation
is preserved. Current main ruleset (21629778) requires Unit Tests & Syntax,
Playwright E2E Tests and Analyze (javascript-typescript), with PR-only changes.
The legacy protection endpoint returns Branch not protected because enforcement
is through the active ruleset; the effective rules endpoint confirms these gates.
No branch policy is changed.

## Intentionally ungated files / remaining debt

| Files | Remaining category and reason |
|---|---|
| content/syncEngine.ts | Mixed DOM/sniff/storage ingestion, sidebar records, timestamp probes and queue; acquisition/callback/completeness surface is exact-gated, whole file is not |
| content/messageRouter.ts | Broad runtime request/response dispatcher, scan result and cancellation mirror; typed detail responses/null fixture cover the migrated path only |
| content/liveSaveCoordinator.ts | Badge DI, queue, runtime bridge, asset/binary/writer/filesystem processing; typed detail acquisition does not imply a typed export pipeline |
| content/domScraper.ts | Network catch, sidebar list and page-debug records; only actual detail assembly/fallback is migrated |
| core/api/geminiClient.ts | Constructor/global/retry/error transport compatibility; public async returns are exact-gated |
| core/api/client/credentialManager.ts, rpcClient.ts | Credential storage/global/DOM compatibility, request credentials/utils/timer contracts |
| core/api/parser/parseDetail.ts, extractors.ts, payload.ts, attachments.ts | Raw JSPB turn/candidate/meta/body/field-44/media/document probes and JSON discovery; unchanged P-01–P-05 behavior must be established before narrowing |
| core/api/parser/structuredContent.ts | Seven double assertions, raw list/table arrays and pre-attached content; no honest whole-file claim |
| core/engine/export/exportCompletion.ts | Broad export record/input/asset contracts outside the narrow titles-map correction |

Shared conversation ChatMessage documents/citations, contentContext
ActiveClientContract/cancellation/global timers, moduleOverrides, BatchWorker
stored/Takeout fallbacks and canonical/export transports also remain outside
W2's migrated acquisition surface. No unrelated legacy any is cleaned to inflate
the gate list.

Backlog disposition: C-01–05 complete for current parser/pagination/provider/sync
boundaries (conversations remains an intentional compatibility alias). C-06/C-09
complete for typed content acquisition and evidence preservation; downstream
stored/Takeout/canonical export migration remains deferred. C-07/C-08 stay open,
coordinated with actual cancellation; C-10 remains a retained unverified scaffold,
not an implemented asset API. Four explicit application assumptions remain at
content resolver sites; future production providers must replace those using real
capabilities, not cast arbitrary providers into Gemini. No broad extension bag is
needed along the migrated chain.

W1's 19 boundary characterizations and P-01–P-05 expectations are unchanged.
The earlier W2-01 live Imagen duplicate/empty-model-header observation remains a
separate unresolved parser semantic finding; a later live pass does not fix or
erase it. Titles, merge, account-slot selection, storage schema, Takeout behavior,
export formats and UI are unchanged by this closeout.

Emission comparison against 9e8bc03 checks 22 W2 boundary files without
normalization/exclusions. Nineteen emit byte-identical JavaScript; only pagination,
GeminiProvider unknown-input reading and the explicit null-document branch differ.
This patch deliberately fixes three runtime completeness cases and does not claim
the entire patch is type-only.

## Validation and next step

| Check | Final result |
|---|---|
| `npm run lint` | Passed (type-aware floating-Promise gate) |
| `npm run lint:zero-any` | Passed for all 14 whole production files |
| `npm run type-check` | Passed with exact awaited returns, strict input variance and all-null deps fixture |
| Title merge / parser boundary filters | Passed; 19 W1 parser cases unchanged |
| Provider filter | 7 suites passed, including typed sync/adapter/neutral input cases |
| Pagination / parser contract filters | Passed, including actual malformed producer payloads and exact contracts |
| messageRouter/liveSave filter; existing live_save suites | New typed detail suite and 5 existing live-save suites passed |
| `npm run test:corpus` | 110 documents, 60 math expressions, zero parse/diff/diagnostic or genuine WASM failures |
| `npm run provenance:summary` | 23 classified suites / 217 tests; this inventory is not newly claimed live parser provenance |
| `CI=1 npm run test:changed` | Full impacted 197 unit suites, types/build and 43 E2E passed without retries (package script change triggers full impact) |
| `CI=1 npm test` | Scoped any gate, types, 197 unit suite files, build and 43 E2E passed without retries |
| `npm run test:live` | Full Tier 2: 24/24, zero failures/skips/warnings |
| `npm run pool:status` / `npm run pool:validate` | 20/20 after replacing two consumed scenarios with distinct new biomedical/operations-research domains |
| Emission / effective branch rules / diff check | Verified as described above; diff check clean |

Tier 2 used the current worktree through clean extension installation; no feature
filter, domain filter, skip flag or shortened dataset was used. It generated
RNA/Imagen and Kitaev conversations, exercised fresh/resumed live disk-save,
transient deletion, Takeout import/title upgrade, full historical scan and
continued-chat promotion, then downloaded and physically unpacked ZIPs.
Eight Markdown conversations passed the four golden-category export assertions;
both new scenarios matched every prompt/reply turn. Images were nonempty and the
uploaded custom attachment hash matched. Eight HTML documents and eight PDFs
passed physical structure/binary checks; stale-tab image recovery also passed.
The online test conversations remain preserved (`ce62119dad454bdd`,
`895e3123ef610e7b`). This passing run does not erase the earlier W2-01 finding.

Validation logs, emission script, scope/debt inventories, active rules output,
corpus report, scenario archive and physical live export artifacts are retained in
the core checkout's ignored `temp/w2-08-validation/` directory. In-scope W2
integration/contract/completeness/gate work is complete; remaining categories
above are intentionally deferred, not mislabeled closed.
Tier 3 is not assigned; no visual-subagent pass is claimed. No Wave 3 is started.
If future parser work is blocked by raw candidate/turn/media probes or the seven
structured-node assertions, targeted Parser Boundary Hardening is a concrete
candidate, with current characterizations and captured payloads as prerequisites.
