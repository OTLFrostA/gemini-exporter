# L4 Format / Packaging / Delivery migration

Authority: [L4 Format design](https://app.notion.com/p/3fc5d4d759e1813f9483eebd058f7066).
This change implements all three L4 responsibilities: Format, Packaging and Delivery. Application, UI, Settings, L1/L2 and L3b callers remain outside this change.

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

Callers outside L4 are intentionally unchanged:

- `src/core/engine/chatFormatter.ts` still imports the removed `toJsonStandard`. The Application owner must supply Domain + Account + Packaging bindings to `serializeDomainJson`.
- `src/ui/controllers/exportController.ts` still imports the removed `PdfExporter`. The Application owner must use its single export workflow, supply the composed AST and shared image resources, call `compileDocumentPdf`, and pass final bytes to Packaging/Delivery.
- Older integration tests that import these removed APIs require the corresponding Application/Delivery migration. Full application build and full-suite success are not claimed by this module change.

After the L3b migration removed resource delivery types from AST, ResourceBindings lives in export/packaging/resourceBindings.ts. L4 consumers import that existing map shape directly. Its runtime ownership is Packaging → Format; no bytes or paths are added to the AST.

## Packaging and Delivery

Authority: [Packaging](https://app.notion.com/p/3fc5d4d759e181c4b0a7c48df1ef2168), [Delivery](https://app.notion.com/p/3fc5d4d759e181118042d6d531e78257).

`export/packaging/index.ts` exposes the three frozen functions: `planExportPaths(inputs, format)`, `buildExportFiles(format, plan, content, prepared)` and `packageExportFiles(groups, delivery, userRequestedZip)`. Each conversation keeps its own resource ID map. One batch-local case-insensitive path set reserves main and asset paths, with suffixes allocated before Format. Resource files use assets/ or files/. No hashes, acquisition or receipt-derived bindings remain in this chain.

Artifact now has exactly fileName, mimeType and content. Markdown/HTML/JSON emit every successful binding as an external file, and missing bound bytes fail before Delivery. PDF emits only the compiled main file. Application must fill successful PreparedResources.mediaType from acquisition metadata first, then the trusted DomainAsset.mediaType. Packaging consumes that prepared MIME and falls back to application/octet-stream when neither exists; the three frozen Packaging interfaces stay unchanged. Resource names without an extension receive the computed MIME/document/kind extension before path reservation, while existing extensions are preserved. ZIP uses the actual flattened file count: explicit preference, or browserDownload with more than one file. Empty input stays empty; ZIP entries have no hidden directory prefix. Single-group ZIP names follow the main basename; multi-group names use conversations_<timestamp>.zip.

`export/delivery/index.ts` exposes `startBrowserDownload(file)` and `writeToFolder(files, directory)`, both Promise<void>. Browser Delivery creates a Blob URL, clicks one download anchor, then schedules URL cleanup. Folder Delivery writes directly into the supplied directory, preserving every planned path. Writers reject unsafe/noncanonical paths rather than renaming them. FsWriter queries existing permission and never requests authorization; writable close/abort and same-path serialization are retained. Neither function chooses a mode, falls back, handles records, or transports bytes/handles through runtime IPC.

The old `planExportResources`, `prepareDomainResources` and `exportDomainDocument` are removed. Their acquisition/orchestration callers belong to Application and must migrate to PreparedResources → plan → Format → build/package → Delivery. `chatFormatter` and `exportOrchestrator` still reference removed interfaces; this is an explicit integration handoff, not a working full-application build. Settings and Live Save changes (including enabledDisk intent and effective state) remain with their owners.

## Module verification

- `node tests/run_l4.cjs`: **347 selected L4 Tier 1 tests pass**, zero failures. `tests/l4-tests.json` is the explicit file/name manifest; the runner fails on any selected group failure and sums executed cases.
- `node scripts/typecheck-v2-modules.cjs`: checks L4 sources and all manifest suites inside the four-module ownership boundary. `tests/tsconfig.l4.json` now includes every L4 suite; standalone compilation also reports four adjacent Application/UI type errors reached by mixed test helpers. See `docs/v2-module-alignment.md`.
- Scoped no-explicit-any lint for new production functions: passes.

Coverage includes renderer semantics, JSON identity/schema, real offline Typst WASM PDF compilation and image/text inspection, fonts/MiTeX, corrupt/missing image bytes, renderer immutability, batch duplicate IDs across accounts, case-insensitive/long/unsafe path collisions, actual ZIP entries matching rendered MD/HTML/JSON references, embedded PDF file count, direct/ZIP policy, permission refusal without a prompt, failed writes/abort, same-path serialization, and one anchor trigger with URL cleanup.

Mixed suites run only their L4 cases: document-freeze (renderer cases), pdf-stress-gates (renderer preprocessing), archive-resource-path (paths/rendered file references), p1_h2_pathwriter (path safety and Writer cases). Application acquisition/selection/Skip/record tests such as resource-delivery, pdf-export and b1_writer_unified are not counted as L4 verification. The old Application integration tests still require their owner's migration; selecting this manifest does not mean those suites pass. Historical renderer fixtures now supply paths independently of production write receipts. Legacy tests expecting resource hashes, absolute bindings or per-PDF orchestration stages were migrated to the new L4 contracts.

Only L4 Tier 1 was run. No full application build/suite, unrelated tests, Tier 2 or Tier 3 was run. Node DOM/filesystem doubles establish the L4 contract, not real Chrome authorization/download compatibility; the design's real-browser checks remain outside this scoped request.

Deprecated CompanionResourcePlan/ArtifactWriteReport exports and all Writer folderName properties, constructor parameters and factory options are removed. Outside-L4 callers must use the selected directory directly as the export root.

Current dev/v2 L3b composition returns DocumentAst directly (without a document/diagnostics wrapper), and metadata no longer contains provider URLs. L4 fixtures and Markdown metadata handling now consume that contract; L3b production code is unchanged. Renderer source notes preserve the current AST-provided label, including the composer's URL fallback.
