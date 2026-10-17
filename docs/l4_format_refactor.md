# L4 Format migration

Authority: [L4 Format design](https://app.notion.com/p/3fc5d4d759e1813f9483eebd058f7066).
This change implements Format only. Application, Packaging, Delivery, L2 and L3b are not migrated here.

## Public inputs and outputs

- `renderDocumentMarkdown(document, resources, options?)` returns a string.
- `renderDocumentHtml(document, resources, options?)` returns HTML and diagnostics.
- `renderDocumentTypst(document, resources, options?)` returns the existing Typst payload.
- `renderers/json/serializeDomainJson.ts` exports `serializeDomainJson(conversation, account, resources)`.
  It accepts existing `ReadonlyDomain`, `Readonly<Account>` and `ResourceBindings`, and returns the five-field Archive v1 JSON string. Domain/Account facts are preserved, keys must agree, resources are always present, and the archive version is independent of Storage.
- `export/pdf/compileDocumentPdf.ts` exports `compileDocumentPdf(document, bindings, prepared, compiler, context, options?)`.
  The context is the existing `PdfCompileContext` without `assets`; Format supplies a resolver over validated, already prepared bytes. It returns the existing `PdfCompileResult`.

Application supplies per-conversation image-only PreparedResources, Packaging bindings and an IPdfCompiler. Format checks image bytes, omits unusable bindings from its local view, renders once, compiles once and validates PDF bytes. Paths are never hashed, generated or renamed. Missing images retain readable placeholders; File cards use AST metadata. Known acquisition failures belong to Export. Compilation errors and cancellation propagate; there is no automatic rerender or retry.

Font resolution and sandbox initialization remain existing Format capabilities. The moved `export/typst/fonts/mountRuntimeFonts.ts` preserves font mounting and its diagnostics. Application provides the authorized font capability and owns compiler lifetime: initialize/mount once for a batch, aggregate font diagnostics, and dispose the compiler in `finally`. Format never chooses a directory, writes a file, records an export or requests resources. MiTeX failure keeps original LaTeX with diagnostics.

## Deliberate integration handoff

The legacy `PdfExporter`, `prepareItem`, `prepareResources` and PDF four-stage pipeline are removed, including their Writer/ZIP/record ownership. They are not retained as a parallel export route. Tests asserting their stage states and content-hash paths are replaced by Format tests; font, math and sandbox tests remain.

Callers outside Format are intentionally unchanged:

- `src/core/engine/chatFormatter.ts` still imports the removed `toJsonStandard`. The Application owner must supply Domain + Account + Packaging bindings to `serializeDomainJson`.
- `src/ui/controllers/exportController.ts` still imports the removed `PdfExporter`. The Application owner must use its single export workflow, supply the composed AST and shared image resources, call `compileDocumentPdf`, and pass final bytes to Packaging/Delivery.
- Older integration tests that import these removed APIs require the corresponding Application/Delivery migration. Full application build and full-suite success are not claimed by this module change.

The ResourceBindings type remains at its existing AST import location to avoid an unrelated L3b migration. Its runtime ownership is Packaging → Format; no bytes or paths are added to the AST.

## Module verification

`node_modules/.bin/tsc -p tests/tsconfig.l4-format.json` checks Format sources and the new JSON/PDF contract tests.
Tier 1 execution uses `node -r ./tests/ts_register.js --test` with explicit renderer, JSON, PDF compiler, MiTeX and font test files. It includes real offline Typst WASM compilation with a Packaging image path, PDF image/text inspection, missing/corrupt bytes, cancellation, archive identity checks and input immutability. No Tier 2, Tier 3 or full application test run belongs to this change.
