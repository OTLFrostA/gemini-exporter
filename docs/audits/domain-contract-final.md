# Final Domain contract cleanup after #925 / #926

## Contract changes

- Remove `DomainMessage.provenance`, its `rawRole` member and `DomainMessageProvenance`. Legacy/provider roles still map to the existing `unknown` role and existing UNKNOWN_ROLE diagnostics. Composer no longer renders a source-role heading.
- Remove `DomainAsset.failureReason`, its parser producers and its export consumers. Takeout keeps missing/ambiguous-resource diagnostics and reports unresolved local archive bindings through existing ResourceResult failures. Remote/data URI resources remain outside ZIP binding failures, preserving their existing acquisition path. PDF acquisition still generates runtime PreparedResources failures; those runtime fields are not Domain fields or persistent replacements.
- Remove `DomainCitation.number`. Citation IDs and authored marker labels still bind references. Composer alone assigns displayed numbers and Sources order, including grounding and URL-less citations.
- Narrow `DomainConversationDetail.titleSource` to the existing `domain/titleAuthority.ts` TitleSource union. Runtime uses the existing TITLE_SOURCES enum. Legacy unknown source strings normalize to the existing default tier, retaining the title and priority rules.
- Asset `generation` and `document` require at least one field in TypeScript and the existing runtime shape validator. Partial generated identity remains accepted; absent resource information is omitted. Independent message generation events survive missing output files.

The existing shape validator reuses its existing key enumeration for the two nonempty-object checks. No additional graph traversal, validation entry point, numeric/range/cross-field check, helper, wrapper, brand, fallback or compatibility layer was introduced. Schema/closure pass counts and all existing closure checks remain unchanged. Storage/Domain/IndexedDB version markers remain 2. Released 1.7/Storage v1 records still enter through the existing legacy-storage Parser.

## Necessary retained field

`DomainAsset.document.hasFabricatedText` remains because `src/core/engine/export/parseDrift.ts:extractChatParseDrift` reads it after a stored Domain snapshot is restored. `src/core/engine/export/exportCompletion.ts:resolveExportRecordStatus` uses that evidence to select `partial`; `exportOrchestrator.ts` also records the caution in export metadata. Parser Diagnostics are transient and are not persisted in the semantic store. Moving this flag solely to Diagnostics would lose the caution on re-export; introducing persistent diagnostics solely to remove the flag would add another structure.

Original document ID, full canonical Markdown, generated-image identity and independent message generation events also remain. Both memory snapshot and physical IndexedDB/reload regressions cover report text, the heuristic flag and image failure detection without a persisted acquisition error.

## Scope and size

Production diff: 37 removed lines, 31 added lines, **net 6 fewer lines** across 12 files. This includes the narrower inline TypeScript unions and the existing shape validator adjustment; it does not count tests or documentation as production deletion.

Normal successful export behavior and image matching/deduplication are preserved. Intended contract changes are removal of obsolete JSON properties, rejection of empty resource metadata/unknown title sources, and uniform unknown-role presentation.

## Verification

- `npm test`: PASS. Zero-any, TypeScript, Python harness/architecture checks, all 266 TypeScript unit suite files, production build and 95/95 Playwright tests (0 skipped) passed on the final code.
- Targeted final-contract and source/import/export regressions: PASS. All supported title-source enum members and each individual generated identity field remain accepted. Deleted fields and empty resource objects are rejected.
- ESLint: PASS across `src/` and the changed/new test files with the supplemental nine structural-error rules in the temporary audit config; no dependency or repository lint config was added. The repository's configured full lint tool is Oxlint.
- `npm run lint` (Oxlint): 0 errors, 1482 warnings. Main baseline was 1478; the four additional warnings are local narrowing assertions for the filtered resource objects and already-normalized title winners, followed by the unchanged Domain validation boundary.
- Scenario pool: 20/20.
- Tier 2: **NOT RUN**. No debug Chrome endpoint was listening at `127.0.0.1:9222`; no live interaction or release acceptance is claimed.

Follow-up: [PR #927 review fixes](domain-contract-review-fixes.md) supersede the nonempty TypeScript unions and remove the four added assertions/warnings. The original results above describe PR #927 at merge time.
