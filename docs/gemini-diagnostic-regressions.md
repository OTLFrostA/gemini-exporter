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

The newer, completed pre-scheduling-fix diagnostic contains 205 fallback warnings:
174 decoder rejections and 31 adapter rejections. Replaying all 205 with their
captured source registries preserves those rejection boundaries. All 31 adapter
cases have invalid source ranges; no offset correction is inferred. This change
repairs completeness and retry contracts, not support for the remaining card
families. Across 106 existing fixture/native-response inputs, body messages,
assets and native acceptance are unchanged from the preceding commit.
