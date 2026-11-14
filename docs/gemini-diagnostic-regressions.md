# Gemini diagnostic regression coverage

The PR #1592 regression inputs use the existing `detailGen(key)` entry point in
`tests/fixtures/providers/geminiDetail.ts`. Factories produce native Gemini RPC
responses; they never execute the production parser to generate expected results.

## Reusable inputs added by #1592

`tests/fixtures/providers/gemini/detail/nativeDocumentCases.ts` supplies seven
keys. `G_NATIVE_DOCUMENT_TRAILER_MATRIX` contains 25 replies: paragraph counts
1, 2, 3, 14 and 25 crossed with trailer flags 0, 1, 2, 7 and 128. The other six
keys cover a second body, visible trailer content, an unknown flag, a negative
flag, multiple outer branches and an unsupported child. The matrix must decode
without fallback and preserve every paragraph. The counterexamples must report
`decode_rejected` and preserve the independent Markdown body through fallback.

`tests/fixtures/providers/gemini/detail/nativeCitationCases.ts` supplies ten keys:

| Key suffix after `G_NATIVE_CITATION_` | Contract checked |
| --- | --- |
| `WORKSPACE` | Structured and Markdown paths retain the same source URL; rendered Markdown links it |
| `ADAPTER_FALLBACK` | Adapter rejection preserves the source binding and records the source registry |
| `COMPOUND` | A compound marker retains the whole source binding |
| `COMPOUND_ADAPTER_FALLBACK` | The compound binding survives adapter fallback |
| `COMPOUND_DECODE_FALLBACK` | The compound binding survives decoder fallback |
| `FILE_LOCATIONS` | Multiple excerpt locations do not invent multiple files |
| `FILE_RANGES` | Excerpt ranges retain one file identity |
| `NESTED_METADATA` | Source bindings can be read from nested candidate metadata |
| `WHITESPACE` | Marker aliases resolve; plain and unbound identifiers remain literal |
| `OTHER_CANDIDATE` | An unselected candidate cannot supply the selected reply's sources |

These are 17 fixture keys representing 41 native replies, including parameter
variants and rejection counterexamples. They are synthetic, sanitized protocol
reproductions, not 41 distinct failures captured from a user's account. Their
assertions live in `tests/gemini_structured_protocol.test.ts`; existing lower-level
decoder and adapter tests remain in place. The fixture catalog and provenance
contract include all keys through `contentCases.ts`.

## Local diagnostic replay for #1592

The second export run in the local 2.1.1 diagnostic report contains 366 structured
fallback warnings across 178 conversations: 327 originally rejected by the decoder
and 39 by the adapter. A warning is not itself an export failure.

| Replay outcome using available native citation sources | Original PR | Revised PR |
| --- | ---: | ---: |
| Originally decoder-rejected: now decoded | 22 / 327 | 147 / 327 |
| Originally decoder-rejected: now adapted | 21 / 327 | 137 / 327 |
| Originally adapter-rejected: now adapted | 2 / 39 | 2 / 39 |
| Total records decoded and adapted | 23 / 366 | 139 / 366 |

The revised result is 38.0% of warning records, an increase of 116 records over the
original PR. Remaining outcomes are 180 decoder rejections and 47 adapter
rejections. Of those 47, 45 lack source identities needed for adaptation and 31
have invalid source ranges; these groups overlap. Two records fail adaptation
without either condition, so these counts are not a complete root-cause taxonomy.

This replay only checks decoding and adaptation with source identities present
in native citation nodes. The old diagnostic format omitted the complete source
registry. No missing registry is fabricated, and the replay does not establish
end-to-end export fidelity. The newer fallback diagnostic records the actual
source registry for future investigation.

The private diagnostic report is not a committed CI corpus. The reusable cases
above cover representative supported shapes and rejection boundaries; there is
no record-by-record mapping that would justify a CI coverage percentage for all
366 warnings. Maps, research-plan, Gmail-action and document-chip payloads remain
outside this repair's supported-shape claims.

## Follow-up: composite headings and native text metadata

The next repair adds eleven keys to the same fixture core:

| Key | Contract checked |
| --- | --- |
| `G_NATIVE_CITATION_HEADING_LEVELS` | A single reply retains headings at all six levels and their linked sources |
| `G_NATIVE_CITATION_HEADING_COMPOUND` | A heading retains a compound source binding |
| `G_NATIVE_CITATION_HEADING_MIXED_SOURCES` | Visible web references and hidden file-source facts retain their identities |
| `G_NATIVE_CITATION_HEADING_NESTED` | Nested inline groups preserve the declared heading level |
| `G_NATIVE_CITATION_HEADING_MIXED_LEVELS` | Conflicting heading levels explicitly fall back |
| `G_NATIVE_CITATION_HEADING_MIXED_PARAGRAPH` | Mixed heading and paragraph declarations explicitly fall back |
| `G_NATIVE_CITATION_HEADING_TABLE` | A heading inside a table's inline-only cell explicitly falls back |
| `G_NATIVE_CITATION_HEADING_BLOCK_CHILD` | A code block inside an inline group explicitly falls back |
| `G_NATIVE_CITATION_QUOTE_METADATA` | Nonzero citation metadata does not change source identity or become body text |
| `G_NATIVE_DOCUMENT_STRIKETHROUGH` | Native style flag 4 preserves the exact strikethrough range |
| `G_NATIVE_DOCUMENT_EMPTY_QUOTES` | Empty quotation containers add no visible quotation or invented text |

The nine tests in `tests/gemini_composite_blocks.test.ts` exercise the production
RPC parser through `detailGen`, including source closure and rendered Markdown.
They also reuse the historical heading-only and empty-quote fixtures. An empty
structured body must still fall back when the independent Markdown is nonempty;
malformed citation metadata and unknown nonempty quotation children remain rejected.

The adapter now obtains the block kind from the text fragments inside field 13,
including nested groups. References and attachments do not declare a different
block kind. Conflicting declarations remain unsupported. This fixes the protocol
interpretation for all heading levels rather than recognizing the fourth-level
headings in the private report by their content.

Final replay against the same 366 warnings gives:

| Outcome | Merged #1592 | Follow-up |
| --- | ---: | ---: |
| Originally decoder-rejected: now decoded | 147 / 327 | 153 / 327 |
| Originally decoder-rejected: now adapted | 137 / 327 | 145 / 327 |
| Originally adapter-rejected: now adapted | 2 / 39 | 2 / 39 |
| Total records decoded and adapted | 139 / 366 | 147 / 366 |
| Remaining decoder rejections | 180 | 174 |
| Remaining adapter rejections | 47 | 45 |

Eight records newly adapt: two composite-heading records, four empty-quotation
records, one strikethrough record and one nonzero citation-metadata record.
No previously successful replay record becomes unsuccessful. The 76 previously
captured live replies also produce identical canonical structured and Markdown
results before and after this follow-up. Their existing 46 dual-parse differences
remain; this comparison does not establish structured/Markdown parity.

All 45 remaining adapter rejections lack source identities in the old report;
31 also contain ranges outside the current text bounds. Range clamping or
inventing a source registry would hide missing evidence. Of the 174 decoder
rejections, the first rejected shapes include Maps (39), document chips (34),
field-0 envelopes (24), research plans (21), Gmail cards (18), annotations (16),
other cards (12), empty field nodes (7), and fields 5, 8 and 9 (one each).
These are first rejection points, not mutually exclusive final causes. Some
cards contain text absent from the independent Markdown, so dropping the card
would not establish a complete export either.

The final `npm test` run passes: 393 unit test suites, all 216 Playwright tests,
strict type checking, the scoped zero-any gate, production build and bundled-font
checks.

Live Tier 2 was attempted with the final build. It finished with 10 passing,
3 failing and 12 dependency-skipped features: the pre-chat scan hit the provider's
500-conversation limit, the required model was absent from the live menu, and
selection of a configured historical conversation failed. New multi-turn chat
and the joint Markdown export checks therefore did not complete. This repair
does not claim a passing live Tier 2 run.

Further source-binding investigation needs a new diagnostic from the affected
account using a build containing #1592, which records the actual source registry.
The private report, source identities, original URLs and account details remain
local and are not part of these reusable fixtures.

## Follow-up: representation integrity and retry

`nativeIntegrityCases.ts` adds seven synthetic `detailGen` inputs for a research
plan omitted from the independent Markdown, an authoritative Markdown-only
reply, a supported native reply, invalid formatting/source ranges, malformed
payloads and competing body branches. The expected text and source tuples are
authored independently of the production parser. Scalar payloads are tested
against each affected node family; explicit empty containers remain valid.

A rejected native body now supplies `unrepresentedContent` as L1 quality evidence.
Adapter rejection supplies the same fact directly, independently of diagnostic
listeners. Pagination completion establishes acquisition coverage; it cannot erase
this evidence and certify the fallback as lossless. Domain receives the existing
`partial` quality, so physical exports retain the usable Markdown with
`otherContentMissing: true` and remain eligible for retry at the same source
version. Missing native content and an unrelated candidate's document are not
rejected native bodies. Valid Markdown-only replies can still become complete.

Recognized wire branches reject unexplained nonempty sibling fields and validate
the payloads they consume. Invalid payloads no longer become empty text, code,
list, quote, table or math nodes. Existing citation/layout metadata remains
accounted for by its established decoder. All formatting, link and source ranges
share UTF-16 bounds and surrogate-pair boundary validation. The internal annotation
union requires source IDs for citations and a target for links.

The IDB schema upgrade from version 1 to 2 withdraws old Gemini completeness
claims once. It retains body bytes, assets, timestamps, destination names and
attachment results; it marks previously complete Gemini details unknown and their
export receipts partial with `otherContentMissing: true`. The previous schema did
not persist enough evidence to identify which Gemini snapshots used a rejected
representation, so the next export must recheck them. Other providers and scan
coverage are untouched. Current confirmed complete snapshots retain the existing
admission protection. No parser version or raw wire array enters Domain.

`gemini_structured_integrity.test.ts` covers the native RPC, complete-pagination
and physical-render boundaries. `gemini_integrity_upgrade.test.ts` exercises the
real schema upgrade, subsequent admission and one-time behavior.
`gemini_structured_integrity_export.test.ts` verifies production parsing, storage,
Markdown delivery and receipts: partial results retry at an unchanged version;
confirmed complete results can subsequently skip.

The integrity-only baseline (before the card recovery below) kept all 205
completed-run fallback warnings partial and retryable: 174 decoder rejections
and 31 adapter rejections. All 31 adapter cases have invalid source ranges.
No offset correction is inferred from their decoded inputs.

## Recovering the remaining completed-run fallbacks

The decoder now projects supported provider cards into the existing paragraph,
list, link and resource model. Internal fragments group those blocks; markup
nodes reuse the HTML/Markdown adapter. No new Domain widget types or persisted
state are introduced. Unknown nonempty sibling branches still reject the body.

| Original first rejection / warning occurrences | Recovery |
| --- | --- |
| Maps / 39 | Both observed Places schemas: names, addresses, own links, available phone/category/description/rating, search footer and route title/duration/distance/ordered navigation instructions |
| Document chips / 34 (kinds 1/2/3) | Ordinary links, retaining multiple chip titles and their individual targets; generated files retain the existing kind-26 path |
| Multiple body sequences / 23 | Select exactly one body independently matching the chosen candidate's Markdown; duplicate or unmatched bodies remain partial |
| Nested empty node / 1, empty nodes / 7 | Empty placeholders cannot erase adjacent content; all-empty native placeholders allow authoritative Markdown |
| Research plans / 21 | Title, ordered steps/descriptions and result link |
| Gmail cards / 18 | Subject, sender, summary, preview and available body; full, preview-only and summary-only shapes |
| Annotations / 16 | Rich place links use their own targets; unbound citation identities retain text and incomplete evidence |
| Flight cards / 12 | Flight order, airport/time/duration, price/availability and separate links |
| Business cards / 1 | Names, ratings/review counts, categories/descriptions, opening labels and own links |
| Finance card / 1 | Linked price summary and supplied Markdown disclaimer |
| Unregistered image reference / 1 | Explicit HTTP image URL plus image MIME becomes an owned resource; registration errors do not become body text |
| Source range failures / 31 | Preserve native text, code and valid formatting; known source identities fall back to paragraph/cell scope, with incomplete quality |

Maps photo previews, viewport coordinates, cached reviews and service identifiers
are linked-source metadata, not authored chat image attachments. These linked
summaries do not reproduce the visual widget or its entire source preview. Route instructions are parsed as strict XML,
with unknown instruction elements rejected instead of silently stripped.
Mail HTML links/images survive conversion and enter the normal resource closure;
code literals remain protected from HTML rewriting.

### Citation degradation is not coordinate repair

Strict inline conversion still rejects all 43 captured overflow text-node
snippets. The body adapter can separately discard invalid/unbound **source**
annotations while retaining valid formatting and known source identities at the
paragraph/cell boundary. It never clamps offsets, subtracts a constant, guesses
a URL or converts a `cit_`/`sp_` token into an `spp_` binding. Invalid formatting
continues to reject. A source-only degradation emits
`GEMINI_SOURCE_ANNOTATION_FALLBACK`, keeps `unrepresentedContent`, and remains
partial/retryable even after complete pagination and physical delivery.

Five legal source/code controls, including an endpoint inside a second code
span, retain their independently specified exact reference positions. ASCII,
CJK and non-BMP counterexamples prevent a blanket coordinate adjustment from
passing as a repair. The report supplies decoded adapter inputs for these 31
occurrences, not their original JSPB or a corrected-coordinate oracle.

### Candidate source evidence and document ownership

Source tables now accept the same exact identity grammar as native annotations:
`spp_`, `sp_`, `cit_` and `0`. Prefixes are never translated, and an unselected
candidate cannot supply a binding. Conflicting records and invalid HTTP URLs
remain rejected. A zero-width `0` annotation without its own source record is
still incomplete; it is not assumed to be a harmless sentinel.

Invalid source coordinates can be recovered when the selected candidate supplies
an independently verifiable quote. Its wire header must agree with both the
UTF-8 byte positions and UTF-16 substring in the selected Markdown. The supported
single-paragraph quote must then have exactly one visible match across all native
text nodes, and every ID on the annotation must agree on that node and span.
Valid coordinates remain unchanged. Repeated text, different punctuation/case,
changed code whitespace, conflicting quotes, missing identities and invalid
formatting cannot be repaired this way. A captured source table with six entries
confirms the header shape; authored positive/negative tests establish the recovery
contract. The old 44 partial source occurrences omit those headers and cannot
retroactively establish a recovered span.

Known document chips now read the ID from their validated schema, rather than
allowing a flattened response ID and assistant narrative to become a document.
Exact document IDs precede legacy substring matching; conflicting exact bodies
are ambiguous. Strict chip metadata cannot borrow a body by title or substring.
Cleaning a research-prompt title preserves its strict identity and cannot enable
a flattened response-ID/narrative fallback.
An explicit chip without owned content remains a missing document and produces
`GEMINI_DOCUMENT_BINDING_FALLBACK`, partial quality and retry eligibility. One
owned packet cannot hide another chip whose body is absent.

The local replay contains native documents and source registries, but not the
original candidate artifact packets. It therefore exposes missing artifact bodies
for all 34 internal-document-chip occurrences: 27 had previously appeared complete,
and seven had received heuristic documents made from assistant text. This corrects
the completeness measurement; it does not demonstrate that 34 original full-RPC
responses lacked their document bodies. Owned-packet inputs continue to recover
their actual bodies and complete successfully.

`gemini_source_evidence.test.ts` uses the common `coverageWire`/`citationText`
fixture core to cover source identity, quote verification and conservative
document binding. The physical export test additionally checks a missing-body
receipt, same-version retry, an exact owned file in the repaired ZIP, and skipping
only after confirmed completion. Original wire evidence is never mutated.

Successful decoding retains L1-only raw document evidence so adapter/source or
document-only failures can include the selected candidate's source table,
artifact packets and grounding references before filtering. These raw fields
remain local diagnostic data; they do not enter Domain or persisted conversation
state. A fresh diagnostic is required to investigate the old missing evidence.

### Executable coverage and private replay

`remainingFallbackCases.ts` extends the existing `detailGen` and fixture catalog.
Bodies, links and RPC identity/framing are authored minimal reproductions, not
captured private replies. `remainingSourceRanges.ts` retains all 43 invalid and
five valid node topologies/endpoints with synthetic text preserving UTF-16
widths, whitespace and surrogate boundaries. Private texts, identifiers and
source registries remain outside Git.

`gemini_remaining_recovery.test.ts` is now a required **default CI** suite, also
available through `npm run test:gemini-remaining`. It runs real RPC parsing,
page merge, Domain admission, composition and Markdown against independent
visible-content/link/order/resource requirements. The previous separately red
acceptance file has been replaced by this default gate; no skips or TODO flags
hide missing recovery.

`gemini_remaining_fallbacks.test.ts`, `gemini_structured_alternatives.test.ts`
and `gemini_structured_card_boundaries.test.ts` cover unsupported siblings,
malformed payloads, unsafe targets, unknown mail extensions, ambiguous/no-match
branches, selection of either branch, exclusion of foreign-branch resources,
code whitespace and literal punctuation. Unparsed CJK emphasis delimiters are
removed for matching only when that exact style span is independently present
in native annotations. Escaped/entity-encoded delimiters remain literal; actual NUL is rejected without
rejecting code that spells a Unicode escape. Otherwise matching stays conservative.

`gemini_structured_integrity_export.test.ts` additionally verifies physical
Markdown delivery and receipts: rejected bodies and source-only degradation
remain partial and retryable at an unchanged version; a repaired source can
become complete and subsequently skip. Integrity/upgrade tests use a genuinely
unknown sibling to represent content loss now that research plans are supported.

A local replay of all **205 original warning occurrences** uses captured native
documents and available source registries with authored identity/version/RPC
framing, then production parse → merge → Domain closure → Markdown:

| Result | Occurrences |
| --- | ---: |
| Native or authoritative Markdown, complete | 119 |
| Native body retained, explicit document body missing in replay | 34 |
| Native body retained, exact source anchoring/binding incomplete | 44 |
| Whole-body fallback retained | 8 |
| Domain/render exceptions | 0 |

Thus 197/205 (96.1%) avoid whole-body fallback. The remaining 86 occurrences are
partial and retryable. The source cases comprise 32 range-overflow occurrences
and 12 unbound-identity occurrences. One additional alternative now matches after
fixing an artificial space inserted between composite inline text fragments and
adjacent citations/punctuation. Separate paragraphs retain their boundaries;
inline code retains its whitespace. The other eight alternative-body records
involve Markdown emphasis without enough independent native style evidence and
retain the original fallback. These counts
are warning occurrences, not unique conversations or a full-fidelity export
rate. They do not prove original full-RPC framing, downloaded attachment bytes,
widget visual fidelity or exact citation recovery.

Across 106 pre-existing regression inputs (including 13 captured live RPC inputs
containing 76 assistant replies), all previously successful outputs remain
unchanged; four previous fallback inputs now retain their native bodies. Resource
registries remain unchanged. The complete Tier 1 and isolated Tier 2 execution
results are recorded with the PR; a partial Tier 2 run is never reported as a pass.

The final source integrated with current main passes `npm test`: 402 unit-test
files plus Python/static checks, TypeScript, the zero-any gate, production build,
bundled-font checks and all 220 Playwright tests. The prior live Tier 2 setup
failures remain unresolved; this does not establish a passing live account run.

## Fresh diagnostic: interaction markup and contextual source positions

The fresh 2.1.1 report records a completed Markdown/folder export: 1,344 exported
conversations (including 37 partial), one skipped and ten not-found failures.
It contains 26 successful source-range recovery events, no document-binding
fallback warnings, and 28 remaining body/source warnings across 26 conversations.
These event counts cannot be compared directly with the older report as an
export-wide repair rate.

The new replay preserves the captured native document, original selected-candidate
Markdown, source table, artifact packets and grounding references. It reconstructs
RPC framing and runs production parse, merge, Domain validation/closure and Markdown
rendering. It does not substitute cleaned fallback text for the original candidate.

| Warning occurrences | Before this repair | After |
| --- | ---: | ---: |
| Whole-body fallback | 13 | 8 |
| Native body with source-only partial quality | 15 | 7 |
| Replayed turn becomes complete | 0 | 13 |
| Domain/render exceptions | 0 | 0 |

The 13 repaired occurrences belong to 13 different conversations; the remaining
15 warnings belong to 13 conversations. Other turns and attachment availability
still affect a conversation's overall export status. This is a semantic replay,
not a fresh account-wide export or attachment-byte verification.

Five body fallbacks came from provider interaction tags such as `FollowUp` and
`ElicitationsGroup`. Export already removed them, but alternative selection compared
them as body text. Both paths now use the same cleanup. Parsed fenced/indented/inline
code, math and escaped markup remain literal. Unknown tag names, including names
that merely extend a known name, remain significant. A different candidate's body
or duplicate matches cannot become the selected body by this cleanup.

Five source-only warnings recover through complete Markdown paragraphs. Source
headers now retain their verified UTF-16 positions as well as quote text, after
both UTF-8 and UTF-16 validation. The parser maps those positions through exact
text/code spans in the complete paragraph. This handles a quote starting inside
inline code and a short snippet repeated in different paragraphs. The complete
visible paragraph must occur exactly once in both the candidate and native text
nodes. Mapping never normalizes code spaces, case or punctuation, crosses blocks,
or approximates escapes/entities or padded/multiline code. All IDs on an annotation
must still agree, valid native ranges stay unchanged, and malformed formatting
remains rejected. The earlier unique isolated-quote recovery remains available
when this stronger contextual mapping cannot be established. Conflicting quote
positions for the same ID are ambiguous even if the quote strings are identical.

Three further source warnings now bind their exact `cit_` IDs from the selected
candidate's direct-citation table (`metadata[0]`), independently of the span-source
table (`metadata[1]`). The direct record's explicit ID binds its actual source
URL; cache/attribution URLs do not become extra sources. Conflicting targets,
malformed records and foreign candidates remain rejected. These byte-only records
do not supply the dual-coordinate quote needed to repair invalid local ranges.

The remaining warnings are nine emphasis-representation disagreements (eight
whole-body and one source-only) without matching independent native style spans,
plus six unbound zero-width `0` occurrences. Neither
dropping literal `**` nor aliasing source IDs provides the missing evidence. They
retain usable text, partial quality and retry eligibility. Separately, the export
records 14 expired resource sources and two unavailable locators; these are
resource-acquisition issues, not decoder failures. Not-found conversations remain
outside this repair's priority.

The shared fixture core drives the new interaction/position counterexamples.
`gemini_source_evidence.test.ts` asserts independently authored exact recovered
coordinates, including repeated snippets, partial code, conflicting positions,
multi-block rejection and unchanged whitespace/punctuation controls.
`gemini_structured_integrity_export.test.ts` additionally exports a selected
alternative with a partial-code quote, checks delivered Markdown bytes and its
source link, verifies an `ok` receipt, and permits skipping only after completion.
Private response bodies, URLs, account IDs and source identities are not committed.

The final source integrated with main `a33ce68d` passes `npm test`: 402 unit-test
files plus Python/static checks, TypeScript, zero-any, the production build
(12 bundles, zero warnings), bundled-font checks and all 220 Playwright tests.
The 52 focused parser/export/import/UI checks also pass. Type-aware lint has no
warnings in changed production files. The 106 frozen inputs retain every prior
success and every asset registry; the 28 fresh replay inputs also retain their
asset registries. Live Tier 2 remains unverified, and no personal browser or
port 9222 was used. Scenario pool remains 20/20 with no consumption.
