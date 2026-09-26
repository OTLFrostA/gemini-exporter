# Canonical contract source trace (F2a)

## Source package

- Package: `gemini-exporter-rendering-contract-v1`
- Version: `1.0.0-draft`
- Input ZIP (read-only, user-supplied): `workspace/user/files/gemini-exporter-rendering-contract-v1.zip`
- Extracted copy used for this work: `~/workspace/goals/gemini-exporter/hidden_files/rendering-contract-v1/gemini-exporter-rendering-contract-v1/`
- Manifest: `SOURCE_MANIFEST.json` in the extracted copy (78 files, sha256 verified all-pass at extraction time)
- Package self-check (`npm run check`: strict tsc + 3 canonical examples + mapping assertions): passed

## What was imported

`canonical/src` (10 files: json, provenance, inline, assets, citations, blocks,
diagnostics, conversation, normalizer, rendering) adapted into this directory.
The JSON Schema was imported unchanged as
`resources/canonical-conversation-v1.schema.json`.
The three canonical examples were imported as test fixtures in
`tests/fixtures/canonical/` after a privacy scan (no accounts, emails or real
session data; synthetic demo content only).

## Adaptations made on import (minimal)

1. Indentation normalized to the repo's 4-space style; file header comments
   added per repo convention.
2. `ThoughtBlock.initiallyCollapsed` removed from the canonical block type
   (integration doc section 3, item 6: view state is not content). Renderer
   folding defaults now live in `ThoughtRenderOptions` in `rendering.ts`.
3. `ConversationTitle` extended with `candidates: TitleCandidate[]` and the
   repo's title-tier sources (`rpc`, `api-detail`, `dom`, `takeout`, `sniff`,
   `legacy`, `default`) alongside the package's `provider`/`user`/`derived`
   (integration doc section 3, item 2). Authority tiers mirror the repo's
   `TITLE_TIER_RANK` exactly for the repo's own sources; see `titleAuthority.ts`
   for the full mapping. **This mapping is flagged for user confirmation.**
4. `RenderContext` gained `AbortSignal` + stage progress; `ExportArtifact`
   gained the companion resource plan and write report (integration doc
   section 3, item 5). Generation, writing and record update stay separate.
5. New modules implementing section 3 fixes: `projection.ts` (unique
   `projectConversation`), `titleAuthority.ts`, `unknownFallback.ts`,
   `assetResolution.ts`, `validate.ts` (runtime structural/size/path/URL
   validation with negative cases).
6. `ConversationKey.accountId` and `NormalizationContext.accountId` carry a
   `TODO(F1)` marker. F2a does not synthesize account ids (integration doc
   section 3: F2 must not invent possibly-colliding ids); validation reports a
   warning when the value is absent.
7. The rich example's `initiallyCollapsed` demo field was dropped on fixture
   import (view state, not content).

## What was deliberately NOT imported in F2a

- `adapters/typst-v8/` (P1a), `renderers/typst-v8/` templates (D6/P1a),
  `renderers/html/` (F2c). F2a is the contract layer only.
- The package is not a runtime dependency: nothing imports the extracted
  copy. The ZIP remains an external development input.

## Naming alignment

The plan doc (`docs/pdf_export_implementation_plan.md` section 3.1) sketched
`ExportDocumentV1`; the adopted v1 package calls the persisted unit
`CanonicalConversationBundle`. F2a follows the package. The plan's
`RenderContext.document` is `RenderContext.bundle` here for the same reason.
