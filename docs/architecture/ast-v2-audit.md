# L3b AST v2 design audit — 2026-10-17

Scope: `src/l3b/ast` and `src/l3b/compose`. This audit concerns the branch implementation, not an assertion that the complete export system has migrated.

Sources fetched during the audit:
- [L3b module](https://app.notion.com/p/3fb5d4d759e181ed9ea7cffc849a5769) — edited 2026-10-17 08:38 UTC.
- [Document Model](https://app.notion.com/p/3fb5d4d759e1811eb7f0e665e59c5249) — edited 2026-10-17 08:38 UTC.
- [Composer](https://app.notion.com/p/3fb5d4d759e181928f01c3403e9ea6c3) — edited 2026-10-17 08:38 UTC.

## Internal implementation and public contracts

| Requirement | Implementation / evidence | Result |
| --- | --- | --- |
| Exact Document/Message/Inline/Block/Cell/Sources schema | `ast.ts`; extracted the six declarations directly from fetched Notion TypeScript blocks and compiled type-equality assertions against production types | Matches |
| `composeDomainDocument(ReadonlyDomain, Readonly<Account>, options?): DocumentAst` | Direct return, options only document language; exact function-type equality check | Matches |
| Detail required, trusted and read-only | Reuses L2 `ReadonlyDomain`; compile-only rejection of optional Detail and old return envelope | Matches |
| Account and Index/Detail key agreement | `readAccount` and `sameConversationKey`; mismatch tests | Matches |
| ID/provider/title/times have specified owners | Source ID from Index key, provider from Account, title/time from Index; no metadata URL or Account profile leakage | Matches |
| Preserve message order, roles/model, partial/unknown/empty bodies | Projection tests; no quality/freshness selection, artificial complete body or source message identity | Matches |
| Minimal recursive Content mapping | All Domain block and inline variants tested; code/math/raw unsupported text preserved; no Markdown reparsing | Matches |
| Table normalization | Uses `tableCellPlacements`; tests cover rich caption, header, alignments, colSpan and rowSpan | Matches |
| Citation numbering and sources | Global order, message-local scoped IDs, explicit inline labels, optional links; source label title → URL → empty, separate number | Matches |
| Reasoning precedes body | One disclosure when reasoning exists; no Settings or collapse-state dependency | Matches |
| Message-owned media only | Explicit content/reasoning/attachment references; suppress repeated attachment tail; no orphan asset placement or acquisition-driven AST changes | Matches |
| Asset names/captions/descriptions | Existing shared L3b helpers select reading labels, retain rich inline trees and resource IDs; no export path or bytes | Matches |
| Exact resource query signature | Type equality against Notion declaration | Matches |
| Resource query recursion and purity | Nested block/inline/table/caption/description/details/placeholder test; fresh Sets, image subset, empty document, frozen input | Matches |
| No extra pipeline/state/manager or I/O | Import and source guards across every AST/Composer source file; no network, storage, renderers, diagnostics or ResourceBindings dependency | Matches |
| Shared runtime unavailable/role/disclosure/unsupported strings | Existing `renderers/shared` helpers/dictionary supply shared translations; Model §3.5 explicitly permits reuse of shared helpers/strings | Existing shared implementation; no format integration claim |

The extracted Notion comparison file is a temporary audit artifact in ignored `tests/output/ast-notion-audit/schema.ts`, not a second production schema.

## Integration boundaries deliberately left to other owners

- Application/export and older integration tests still unpack the former Composer envelope.
- L4 consumers still import the removed AST `ResourceBindings` type; its owning module must define the L4 contract.
- `core/export/pdf/pipeline/resourceStage.ts` still calls `collectDocumentResources`; the design requires Export orchestration to collect once and pass prepared inputs onward.
- Common runtime strings remain in the existing shared renderer helper/dictionary. If the L4 migration moves their ownership, consumers must share one implementation; AST must not add a parallel dictionary or runtime availability fields.
- Same-document rendering, missing-binding presentation, JSON direct archival and all export entry-point migration have not been validated end to end in this audit. They cross the user's AST-only boundary.

PR CI currently reports a failed `Unit Tests & Syntax` gate. This audit does not claim a green repository or merged PR, and does not modify other modules to repair their old interfaces.

## Verification

- 27 AST-only Tier 1 tests passed after migrating the existing AST cases as well as the new contract suite. Run the complete pure AST files, then select the AST cases in mixed legacy files:

```sh
node -r ./tests/ts_register.js --test tests/ast-composer.test.ts tests/document-ast-contract.test.ts tests/domain-ast-projection.test.ts
node -r ./tests/ts_register.js --test --test-name-pattern '^AST:' tests/content-domain-boundary.test.ts tests/domain_document_direct.test.ts tests/document-neutral.test.ts tests/document-freeze.test.ts tests/conversation-representation.test.ts tests/domain-contract.test.ts
```

The `AST:` selection is an ownership boundary, not a claim that the omitted integration tests pass. Existing renderer/export assertions from `domain-ast-projection.test.ts` are preserved in `document-ast-integration.test.ts`. Date and metadata ownership cases in mixed files are separated from their integration assertions. AST setup in the affected model/boundary tests now consumes the direct Composer return. Source-list labels no longer duplicate numbering.
- Strict targeted TypeScript compilation passed for `ast-composer.test.ts`, `ast-composer.types.ts`, `document-ast-contract.test.ts` and `domain-ast-projection.test.ts`. The earlier extracted Notion schema/interface equality assertions also passed. Whole mixed-file type checking still reaches deferred downstream modules and is not claimed green.
- No other module tests, full suite, live tests, Tier 2 or Tier 3 were executed locally.

Conclusion: no remaining discrepancy was found inside the audited AST implementation or its two documented public function contracts. Full cross-module conformance remains unverified and has known outstanding caller migrations.
