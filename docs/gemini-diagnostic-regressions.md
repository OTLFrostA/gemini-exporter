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
| Native or authoritative Markdown, without a body/source fallback warning | 152 |
| Native body retained, exact source anchoring/binding incomplete | 44 |
| Whole-body fallback retained | 9 |
| Domain/render exceptions | 0 |

Thus 196/205 (95.6%) avoid whole-body fallback. **145** become complete; the
other seven warning-free bodies retain existing heuristic-document partial
quality. The nine unmatched alternative-body records retain the original
fallback rather than guessing ownership or concatenating versions. These counts
are warning occurrences, not unique conversations or a full-fidelity export
rate. They do not prove original full-RPC framing, downloaded attachment bytes,
widget visual fidelity or exact citation recovery.

Across 106 pre-existing regression inputs (including 13 captured live RPC inputs
containing 76 assistant replies), all previously successful outputs remain
unchanged; four previous fallback inputs now retain their native bodies. Resource
registries remain unchanged. The complete Tier 1 and isolated Tier 2 execution
results are recorded with the PR; a partial Tier 2 run is never reported as a pass.
