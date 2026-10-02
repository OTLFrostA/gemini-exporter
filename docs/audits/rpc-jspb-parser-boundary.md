# RPC / JSPB parser boundary characterization (Wave 1)

Audited against `8966cf7` (after W1-01/W1-02). This wave changes tests and
analysis only. It neither validates new wire schemas nor rewrites production.

## Inspected surface and trust boundary

Parser files: `src/core/api/geminiParser.ts` and all six modules in
`src/core/api/parser/`: `payload.ts`, `parseList.ts`, `parseDetail.ts`,
`extractors.ts`, `attachments.ts`, `structuredContent.ts`.
Upstream contracts inspected: `geminiClient.ts`, `client/rpcClient.ts`,
`client/pagination.ts`; the live bridge also calls the same parser facade.

`GeminiClient.getConversationList` / `fetchConversationPage` read `resp.text()`
and call `parseList` / `parseDetail`. The network response remains untrusted.
Within the parser, the earliest text decoder is `robustFirstPayload`
(`extractors.ts:439`): it strips XSSI framing, tries `JSON.parse`, scans chunks,
and may repair unclosed array brackets. Its return type is `unknown[] | null`,
but `Array.isArray` proves only the outer container, not its elements or slots.

The first shape assumption is the WRB tuple scan in `extractInnerPayload`
(`payload.ts:46`); header and string slots are checked, but other tuple fields
are not modeled. The strongest trust leak is its inner `JSON.parse`
(`payload.ts:69,77`) and `inner: any` result. List/detail code then indexes this
value as a JSPB array without validating the whole shape. The new tests prove
that this boundary also accepts objects, scalar strings/numbers, and null.
Neither envelope discovery nor `isTurn` is a complete domain validator.

Current flow:

```text
HTTP/sniffed response text (untrusted)
  -> parseList / parseDetail
  -> robustFirstPayload: outer-array check + framing recovery
  -> extractInnerPayload: partial WRB checks, JSON.parse -> any
  -> slot probes / isTurn / recursive heuristics (partial validation)
  -> parser-local ListParseResult / DetailParseResult + Message objects
  -> downstream conversation normalization / canonical export model
```

Intended future flow:

```text
raw wire payload -> unknown -> narrow / validate
  -> parser-local typed shape -> canonical domain model
```

Keep diagnostics and `_raw` evidence separate from trusted output. A typed
`Message` return annotation does not validate the `any[]` attachment/documents
assembled beneath it. The canonical export model is a downstream boundary;
parser-local JSPB tuples, media evidence, and `GeminiStructuredDocument` must
not be confused with canonical export block types.

## Unsafe-typing inventory

Locations below refer to the audited production baseline. Grouped rows cover
related occurrences; “external” includes decoded-but-not-yet-validated wire
data. `Array.isArray` also exposes `any[]` elements through library narrowing,
even in functions whose declared input is `unknown`.

| File / symbol (lines) | Unsafe pattern | Value origin | Wave 2 replacement category |
|---|---|---|---|
| `payload.ts`: `InnerPayloadDiscoveryResult`, `extractInnerPayload` (11,46–77) | `inner: any`, two `JSON.parse` calls, WRB `[0..2]` / error `[5]` probes | External envelope/inner JSON | `unknown` + narrowing; parser-local WRB tuple guard; decoded-inner guards |
| `payload.ts`: `extractCandidateValue`, `extractWithScan`, `extractNextPageToken` (105–148) | Array narrowing followed by index/scan access; `T` relies on transform validation | External candidate slots | Preserve generic transforms; narrow to `unknown[]` before probing |
| `parseList.ts`: `getSchema`, `getProtocol` (32–38) | `any` return types | Internal constants | Existing schema/protocol types; upstream contract fix |
| `parseList.ts`: `parseList` (99–144), `extractListItemTimestamp` (46–67) | Unvalidated `inner[...]`, arbitrary row ID/title/count slots, tuple `[seconds,nanos]` probes | External list records | Parser-local list-row shape/type guards; maintain slot/scan precedence |
| `parseList.ts`: `ListParseResult`, catch (17–18,153) | `_raw`/`_debug: any`, caught `e: any` | External evidence; internal diagnostics/errors | `unknown` evidence; explicit diagnostic shape; error narrowing |
| `extractors.ts`: module contract, `getUtils`, `getProtocol` (146–147,226–232) | `any` dependency returns | Internal modules | Upstream facade/dependency contracts |
| `extractors.ts`: `detectTurnSchemaDrift` (289–332) | Nested ID/candidate probes; global/window `as any` | External turns; internal debug flags | Turn/candidate guards; existing global declaration types |
| `extractors.ts`: `robustFirstPayload` (439–526) | Five `JSON.parse` sites, outer-array-only checks | External text/chunks | Assign parse results to `unknown`; envelope/chunk guards preserving recovery |
| `extractors.ts`: `hasTurnContentMarkers`, `extractModelCandidates`, `extractCandidateText` (254–407) | Tuple-like slot access, `cand as any`, boolean recognizers rather than typed shape guards | External turns/candidates | Small turn/candidate/body unions; type guards; keep compact variants |
| `extractors.ts`: `extractGroundingCitationMarkers`, `extractConversationTitle` (565–576,639–675) | Node field-44 `as any`, `t[2][0][0]` through `as any` | External grounding/title candidates | `unknown` + object/tuple narrowing |
| `extractors.ts`: `deepWalk`, `extractThoughts`, `extractCitations`, `extractConversationId`, `extractMetaTitleFromTop`, timestamp helper | Broad `Record<string, unknown>` assertions; recursive/tuple slots; meta payload inherits `any` | External trees (not fully validated) | Shared unknown-tree guards; small citation/thought/meta/timestamp shapes; preserve existing typed outputs |
| `parseDetail.ts`: module interface, `getUtils`/`getProtocol`/`getSchema`, `parseDetail` overrides (34–35,81–90,552) | `any` module/override contracts; unused `_overrides` | Internal dependency injection/API surface | Upstream contract fix, without API churn |
| `parseDetail.ts`: `extractTurnRequestId`, `isTurn`, `isTurnsArray`, `findTurnsDeep`, `TurnsExtractionResult`, `extractTurnsFromInner` (115–255) | `turn`/`inner`/`turns: any`, alternate `JSON.parse`, nested meta slots, boolean guard, object casts | External turns/alternate envelopes | `unknown` + guards, parser-local tuples/unions; preserve depth/50% recognition policy |
| `parseDetail.ts`: `buildUserMessage`, `parseCandidateResponse` inputs and ID/text scans (259–390,530) | `turn`/`cand`/`inner: any`, callback `any`, unchecked slots | External content entering message assembly | Typed parser-local shape + narrowing |
| `parseDetail.ts`: message/media/document assembly (314,411,437–438,472,493) | `attachments`/`docDetails: any[]`, image callback `any`, `contentMatch as any` | Already-internal extractor outputs mixed with raw evidence | Existing image/file/doc types; canonical domain message/attachment types; explicit doc-export shape |
| `parseDetail.ts`: result/debug/error/timestamp filter (26–27,648,667,703) | `_raw`/`_debug`/error/filter `any`; title-map key assertion (664) | Mixed external evidence and internal results | Unknown evidence, diagnostics type, inferred numeric filter, title-source union, error narrowing |
| `attachments.ts`: `ImageNodeDetector`, `detectAttachmentType36` (167,237–245) | Input `any`, object `as any`, tuple/image property probes | External array/object media nodes | `unknown` + detector-specific guards; parser-local media union |
| `attachments.ts`: `extractImages` (369–373) | `JSON.parse` evidence clone after detection | Copy of external evidence, not new network JSON | Keep evidence `unknown`; no claim that clone validates shape |
| `attachments.ts`: `findDocContentById`, `parseDocSections` (636,658,673) | `matched: any`; writes extra `contentMatch` property onto matched raw array; `as any` read | External doc array mixed with internal heuristic tag | Parser-local matched-document wrapper/type; preserve heuristic provenance |
| `attachments.ts`: image tuples, `extractUserFiles`, `extractDocumentsMeta`, clue lookup | Narrowed arrays with positional fields / flat-string heuristics | External media/docs | Small tuple/shape guards; existing `ImageAttachment`, `UserFileAttachment`, `DeepResearchDocMeta`, `DocSectionsResult` outputs |
| `structuredContent.ts`: `decodeGeminiStructuredNode` (165–218) | Seven `as unknown as GeminiStructuredNode` returns; `items`/`rows as any[]`; broad object assertion | External wire or object nodes, only partially checked | Construct validated discriminated nodes; narrow children/cells/items; do not replace with a cast |
| `structuredContent.ts`: `GeminiAttachmentNode` (72–76), annotation/payload decoder | `[key: string]: unknown`, object assertions and many numeric wire slots | External attachment extensions/structured fields | Keep necessary evidence unknown; validate known attachment/annotation fields; typed wire-node decoder |
| `structuredContent.ts`: `extractStructuredContent` (419–427) | Fixture/object `.structuredContent as any` | Untrusted pre-attached object or test input | Property guard + existing payload decoder; retain primary-candidate correlation |
| `geminiParser.ts`: `GeminiResponseParserFacade` (14–34) | Attachment/citation/title/doc/visitor/override inputs or outputs broadened to `any` | Mixed raw inputs and already-typed module outputs | Reuse extractor output types and callback signatures; upstream facade contract fix |
| `geminiClient.ts`, `client/rpcClient.ts`, `client/pagination.ts` | Parser getter `any`; decoded page/message arrays and callbacks `any`; credentials/options/timeout also `any` | Internal client contracts; parsed page results; unrelated transport settings | Narrow parser/page/message contracts after parser types stabilize; defer credential/retry cleanup |

Searches found no `Record<string, any>`, generic `<any>`, `@ts-ignore`, or
`@ts-expect-error` in the seven parser files. Their absence is not proof of
safe typing: the indexed accesses, broad facade declarations and double
assertions above remain. Transport `AbortSignal.any` is an API name, not a
TypeScript escape hatch.

## Characterization coverage and evidence limits

`tests/parser_boundary_characterization.test.ts` adds 19 tests using the
existing Node test runner. Coverage includes list/detail golden outputs,
null/missing/empty/truncated nodes, extra slots, cursor/timestamp precedence,
chunk recovery, shifted nesting, alternate envelopes, malformed titles,
candidate variants, thinking/citation filtering, attachments and drift/debug
propagation. Tests assert message order/content, timestamps, provenance,
attachment paths and diagnostics, rather than merely asserting “no crash”.

The sanitized `wire-case-b-cand.json` and `wire-turn-3-12-b-stack.json` fixtures
from the existing PR #705 Tier-2 evidence are reused for full detail parsing,
structured-content equality, search-image retention and truncated-tree
fallback. All other new probes are synthetic and cannot justify new wire
compatibility rules. No fresh live captures or P0 provenance claims are made.

Existing `test:corpus` evaluates canonical Markdown/LaTeX/Typst, not Google RPC
envelopes. It remains useful downstream validation and passed with 110
documents / 60 math expressions / zero diagnostics or compile failures.
`provenance:summary` covers the existing canonical/math manifest (23 suites,
217 tests); it is not an inventory of the new RPC probes. Neither harness is
replaced or extended into a competing parser runner.

## Behavior findings deliberately left unchanged

1. `turnsRejected` counts recognizer failures, but `parseDetail` still iterates
   those entries. A rejected head with a readable user payload can emit a
   user message. The new known-behavior test records this diagnostic/message
   mismatch; a future behavior fix should decide whether to skip such entries.
2. A candidate containing only `['rc_missing']` yields that ID as model content
   through `extractCandidateText`'s single-element fallback. The new test
   records the current leak; do not silently fix it during a typing refactor.
3. A malformed image tuple with an allowed Google URL can still become a
   generic user file named `attachment`. This reflects permissive file
   discovery, not proof that the image was valid; any tightening needs its
   own compatibility evidence and behavior change.
4. Missing detail titles use the newest wire turn's prompt in
   `extractConversationTitle`, while flat-user fallback can use the first
   chronological parsed user message. New tests retain that existing order.
   Optional null user payloads also produce a drift warning even when a model
   answer parses successfully. No precedence or diagnostic policy is changed.

## Recommended Wave 2 order

1. Model internal schema/protocol/facade dependencies and diagnostic outputs;
   reuse existing media/citation/title types before adding wire types.
2. Make JSON decode results `unknown`; add small WRB and inner payload guards
   in `payload.ts` / `robustFirstPayload` while preserving framing recovery.
3. Type list-row/timestamp/cursor shapes and lock existing slot precedence.
4. Type turn recognition, alternate nesting and candidate/body unions; retain
   discovery limits and characterize known issues separately from typing.
5. Narrow attachment/doc detectors, preserving raw evidence, heuristic tags,
   deduplication and filename behavior. Model constructed document records.
6. Construct validated structured nodes instead of returning doubly asserted
   raw objects; preserve candidate-0 correlation and whole-document fallback.
7. Type detail message assembly and update facade/client/pagination consumers;
   run the focused probes, downstream corpus and complete Tier-1 gates after
   each stage. Expand zero-any lint scope only after each module is clean.

Pure type changes must retain these characterizations. Semantic corrections
need a separate decision and regression updates; real parser behavior changes
also require the repository's complete Tier-2 live validation.
