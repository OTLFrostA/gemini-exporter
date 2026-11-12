# Gemini diagnostic regression coverage

The PR #1592 regression inputs use the existing `detailGen(key)` entry point in
`tests/fixtures/providers/geminiDetail.ts`. Factories produce native Gemini RPC
responses; they never execute the production parser to generate expected results.

## Reusable inputs

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

## Local diagnostic replay

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
