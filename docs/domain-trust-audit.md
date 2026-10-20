# Trusted Domain boundary audit

## Scope and code assessment

The six-step change removes repeated Domain validation after established trust boundaries. It does not change Domain/Document AST semantics, parser heuristics, pagination/completeness policy, persisted schema versions, or JSON export formats. PRs [898](https://github.com/OTLFrostA/gemini-exporter/pull/898), [899](https://github.com/OTLFrostA/gemini-exporter/pull/899), [900](https://github.com/OTLFrostA/gemini-exporter/pull/900), [901](https://github.com/OTLFrostA/gemini-exporter/pull/901), and [902](https://github.com/OTLFrostA/gemini-exporter/pull/902) establish the boundary; the final gate and this audit preserve it.

The original direction is justified by repeated Closure checks in dispatch, adaptation, transport and export. Two qualifications are essential: the TypeScript brand does not freeze mutable objects, and one storage restoration operation intentionally contains two Schema checks, before and after JSON serialization. Removing the latter would weaken snapshot safety. A semantically empty conversation ID remains legal at the Parser boundary; a persisted storage identity must be nonempty.

## Authorized trust boundaries

| Entry | Owner and behavior |
| --- | --- |
| `validateParserDomain` | `src/l2/runtimeValidation.ts`; Schema + Closure at final RPC, DOM, Takeout, legacy-record and merged-page construction. Dispatcher returns the existing result. Merge validates its new graph once. |
| `restoreDomainSnapshot` / `readStorageDomain` | Runtime validator, re-exported by `src/l3a/domain/validate.ts`, called by `domainStore.ts` on incoming writes and physical reads. JSON-detached snapshot, pre/post Schema, storage identity and Closure. |
| `requestNativeDetail` / `requestNativeBatch` | `src/shared/utils/nativeDetailTransport.ts`; controlled Chrome runtime/tab channels, versioned envelope and root shape only. Business errors, retry, cancellation and raw diagnostics survive. |
| `callDomainBroker` | `src/l3a/domain/transport.ts`; authenticated Broker response envelope/version/root checks. Background incoming writes still establish snapshot trust. |
| Raw page bridge | `src/l1/sniffer/gemini/messageBridge.ts`; validates used protocol fields, then sends raw text into Parser. A page message never establishes Trusted Domain. |

The only product brand-related assertions are in `validateParserDomain`, `restoreDomainSnapshot`, the private transport `nativeResult`, and `callDomainBroker`. The latter two adapt the controlled transport contract; they do not accept arbitrary page or disk data as trusted. No brand property is serialized into Domain. Persisted records retain the unbranded Domain type.

## Checks retained and removed

| Area | Retained | Removed |
| --- | --- | --- |
| Parser | Schema and Closure on each newly constructed final graph; final merged graph validation | Dispatcher revalidation of already finalized results |
| Storage | Detached write/read snapshot validation; record envelope/version, identity, acquisition, digest and resource bindings; defensive returned copies | Full AST checks on already trusted in-memory copies and record-to-parse-result adaptation |
| Native transport | Authenticated channel, version and shallow envelope/root checks; errors/retry/cancel | Full Schema/Closure checks on an established typed result |
| Composer/export | Trusted input type; Positional document message identities, escaping, URL sanitization, missing asset handling, cancellation, Typst compilation and delivery failure | Repeated full AST Schema/Closure checks in JSON, HTML, Markdown and PDF preparation |
| PDF selection | Explicit `pdfDomainSelection(TrustedDomain)` adapter; metadata structurally excludes Domain/result fields | Guessing a raw Domain from `providerId` or forced Domain assertions |

Trusted means structurally validated at the source boundary. It does not mean complete history, available attachment bytes, successful compilation, or successful delivery. Those remain independent conditions.

## Measured calls

`tests/domain_trust_counts.test.ts` instruments the actual Schema and Closure functions in a test-only bundle. The 1,000-message fixtures cover complete, partial and unknown completeness, legal unknown blocks/role provenance and an opaque asset. No product telemetry is added. Storage counters exercise the normal snapshot/recovery implementation with the isolated test backend; real Chrome IndexedDB persistence and byte isolation are independently covered by Playwright, not inferred from these counters.

| Independent operation | Schema | Closure |
| --- | ---: | ---: |
| DOM finalization | 1 | 1 |
| Two Takeout conversations, sync | 2 | 2 |
| Two Takeout conversations, async | 2 | 2 |
| RPC finalization | 1 | 1 |
| Dispatcher including its Parser | 1 | 1 |
| Merge of trusted pages into a new graph | 1 | 1 |
| Legacy-record finalization | 1 | 1 |
| One incoming storage snapshot | 2 | 1 |
| One stored-record recovery | 2 | 1 |
| Trusted storage record adaptation | 0 | 0 |
| Authenticated native/Broker adaptation | 0 | 0 |
| Composer, Standard JSON, HTML, Markdown, PDF preparation | 0 | 0 |

An existing physical record read during an update is a separate restoration operation and must still be checked. JSON serialization, cloning and export rendering still traverse data; these counts are not an end-to-end performance benchmark. The DOM counter fixture isolates finalization; existing DOM and Playwright tests separately check fidelity.

## Long-term gate and limitations

`tests/arch/domain-trust-boundary.test.ts` reads compiler AST nodes across `src`, using `tests/helpers/domainTrustBoundary.ts`. It checks boundary imports/re-exports/calls, import and variable aliases, namespace calls, literal computed properties, destructuring, parentheses, branded/raw Domain assertions, parenthesized double assertions, unknown-to-trusted predicates, typed `JSON.parse` upgrades and copied Schema descriptors. Independent virtual-source negatives prove rejection; comments and ordinary strings do not count as calls. Assertions are constrained to both their allowed module and function. `check-zero-any.cjs` also invokes scoped type-aware unsafe-operation lint for the validator and native detail/batch modules; the existing scoped no-any gate remains intact.

This is an architecture regression gate, not a hostile-code sandbox. It cannot recognize every arbitrary reimplementation of validation or all dynamically constructed JavaScript calls. A mutable branded object can be changed after validation; the type system does not prove every such mutation safe. Builders must finalize new semantic graphs, metadata-only copies must preserve structure, and storage must continue validating detached incoming snapshots. These limitations are explicit rather than hidden behind a stronger trust claim.

## Verification evidence and outstanding baseline failures

Each implementation PR passed full `npm test` (unit tests, scoped lint/type checks, build and all 95 Playwright tests) before submission. GitHub required CI passed before each merge. The final gate adds negative architecture probes, source/read/write/transport/export call-count assertions and scoped unsafe-operation lint. Existing invalid-input, isolation, failure, attachment and export tests remain in place.

The closeout addresses the integration of Standard JSON removal with the count test: merged main had a stale OpenAI-format invocation even though the separate PR checks passed. Current counters retain Standard JSON, HTML, Markdown and PDF preparation. Verification must include merged-main CI, not just branch CI. The following baseline results distinguish corrected test contracts from the separate live acceptance work:

- The earlier global lint baseline had two `no-floating-promises` errors in `src/l3a/schemaState.ts`. Current main uses explicit asynchronous badge failure handling; lint and trust-specific enforced lint pass. Existing global warnings remain.
- Real profile upgrade from the official 1.7.0 ZIP originally reported 4/5 PASS and failed offline recovery of bodies/images never persisted by that runtime. The closeout harness now inventories original disk bodies and byte hashes, requires their preservation after upgrade/restart, and reexports only persisted bodies offline. Missing original bodies are explicitly `not_applicable`, never successful recovery. Their offline export is still attempted as a negative check: native failure, no fake body file, and unchanged existing export records are required. The verified official run reports `passed_with_na`: four stages PASS and one NA. Same profile/identity, metadata, export records, new activity/export and failure-not-marked-exported checks remain enforced. Positive and loss/corruption counterexamples test the persistence contract without seeding the real old profile.
- Full no-skip live Tier 2: same-account passive RPC coverage never initializes, blocking formal scenario generation; dependent stages are scheduler-skipped and the run is overall FAIL. The existing fast-skip feature also fails because the expected ephemeral record is absent. Real deletion/archive retention, Takeout/title upgrade, full/incremental scan and downloaded six-conversation multimodal ZIP assertions pass. These partial successes do not constitute a full Tier 2 PASS.

No live expectation or mandatory stage was weakened. Scenario pool checks remain mandatory; when blocked before scenario consumption its 20/20 level is unchanged. Logs and downloaded private evidence remain local rather than being committed. Notion records the distinction between code delivery and the blocked broader acceptance conditions.
