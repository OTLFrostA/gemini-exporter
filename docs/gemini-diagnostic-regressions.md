# Gemini diagnostic regression coverage

The Gemini RPC regression inputs use `detailGen(key)` in
`tests/fixtures/providers/geminiDetail.ts` and `coverageWire` in
`tests/fixtures/providers/gemini/detail/content.ts`. Factories construct native
Gemini wire payloads directly and never execute the production parser to generate
expected results.

## 1. Envelope & citation baseline (#1592)

- `nativeDocumentCases.ts`: `G_NATIVE_DOCUMENT_TRAILER_MATRIX` (25 replies:
  paragraph counts 1/2/3/14/25 crossed with trailer flags 0/1/2/7/128) plus six
  counterexamples (`decode_rejected` preserving independent Markdown fallback).
- `nativeCitationCases.ts` & composite heading extensions:
  - Workspace, uploaded-file and web citations across `structured`, Markdown
    fallback and reasoning (`gemini_structured_protocol.test.ts`);
  - Field-13 composite headings (`1..6`), nested inline groups, strikethrough
    flag `4`, empty quotation containers and nonzero citation metadata
    (`gemini_composite_blocks.test.ts`).

## 2. Protocol-bound candidate ownership

Inspection of the public frontend decoder (`CANDIDATE_OWNERSHIP_FINDING.md`)
establishes that repeated `turn[3][12][i]` documents correspond 1:1 to
`turn[3][0][i]` candidates by original index, selected by `turn[3][3]`:

- `inspectStructuredContent` binds directly to `turnDocument[candidateIndex]`
  without Markdown similarity heuristics (`gemini_document_ownership.test.ts`).
- Missing/empty entries fall back to the selected candidate's Markdown; rejected
  entries stay `partial` and never borrow a neighboring candidate's document or
  resources.

## 3. Representation integrity & IDB v2 upgrade

- Pagination coverage (`coverageComplete`) is separated from representational
  completeness (`unrepresentedContent` in `qualityEvidence.ts`). Recognized wire
  branches reject unexplained nonempty sibling fields and malformed scalar
  payloads (`gemini_structured_integrity.test.ts`).
- Formatting, link and citation annotations share UTF-16 bounds and surrogate-pair
  boundary validation.
- The one-time cursor-based IndexedDB v1-to-v2 upgrade (`src/l3a/idb.ts`)
  downgrades historical unverified `complete` Gemini `details` to `unknown` so
  subsequent refreshes can admit repaired snapshots, while preserving all stored
  bodies, other providers and existing `ExportRecord` receipts untouched
  (`gemini_integrity_upgrade.test.ts`, `e2e/gemini_integrity_upgrade.spec.ts`).

## 4. Provider cards, source ranges & document ownership

- **Validated card projection (`cardNodes.ts`)**: Research plans (`field 27`),
  Maps places/routes (`field 6`), document link chips (`field 24`, kinds 1/2/3),
  Flight (`field 4`), Business (`field 5`), Finance (`field 8`), Gmail (`field 30`)
  and rich place-link annotations project into existing Domain blocks/inlines/assets.
  Unknown sibling fields or malformed schemas reject cleanly
  (`gemini_remaining_recovery.test.ts`, `gemini_remaining_fallbacks.test.ts`,
  `gemini_structured_card_boundaries.test.ts`).
- **Source attribution & verified range recovery (`sourceAttributions.ts`, `sourceRanges.ts`)**:
  - Binds exact candidate-local `spp_`, `sp_`, `cit_` and `0` IDs across
    span-attribution (`metadata[1]`) and direct-citation (`metadata[0]`) tables.
  - Recovers out-of-bounds source coordinates only when the selected candidate
    supplies a dual-verified (UTF-8 byte + UTF-16 code-unit) quote matching a
    unique visible native anchor or unique identical paragraph. Unresolved source
    annotations preserve native text/formatting and bound sources at paragraph
    scope while marking quality `partial` (`GEMINI_SOURCE_ANNOTATION_FALLBACK`).
  - In developer mode, `GEMINI_SOURCE_REPLAY_EVIDENCE` retains one decoded
    `hNvQHb` payload per source-failing page for offline replay
    (`gemini_source_evidence.test.ts`).
- **Document binding & missing locators (`turnResources.ts`, `sourceAttachments.ts`, `geminiProvider.ts`)**:
  - Typed `candidate[30]` artifact packets establish complete document ownership.
  - Response-level `createDocumentReader` recovery excludes candidate narrative
    (`slot 1`), citation metadata (`slot 2`) and nested identified containers,
    preserving recovered legacy Deep Research bodies as `partial`
    (`hasFabricatedText: true`).
  - Unresolved strict document chips retain `contentMissing: true` and classify
    missing locators as `RESOURCE_LOCATOR_UNAVAILABLE` without inventing HTTP
    statuses (`gemini_structured_integrity_export.test.ts`).
