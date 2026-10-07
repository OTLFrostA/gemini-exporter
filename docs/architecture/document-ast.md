# Document AST and rendering boundary

**A renderer must not reinterpret source semantics. A renderer may perform layout.**

Provider/legacy adapters parse and reconcile external inputs into Domain facts and relationships. The composer selects content, organizes the logical document and declares product presentation intent. A format-neutral Document AST is then rendered through HTML, Markdown or PDF backends. HTML, Markdown and PDF compose directly from Domain. Domain and Document AST are the only internal conversation representations; the former Canonical model and its compatibility APIs have been deleted.

```text
raw input -> provider / legacy parser -> Domain
                                          |
                                   direct composer
                                          |
                                   Document AST v2
                                          |
                      +-------------------+-------------------+
                      |                   |                   |
                 HTML backend       Markdown backend      PDF backend
                 CSS / controls     GFM projection        Typst layout
                 responsive layout  escaping              measurement / pagination
                      ^                   ^                   ^
                      +---- RenderOptions / prepared resources+
```

## Field ownership

Domain owns input facts and relationships: body content, reasoning, citations, stable asset identity and authored metadata. Authored headings, emphasis, table alignment and spans remain content facts. Intrinsic image pixel dimensions are resource facts; output positions and physical display sizes are not.

The composer supplies message containers and author-label descriptors, source groups with bound citation labels/targets, code header intent, figures with associated rich captions, file labels/descriptions/raw metadata, and logical table occupancy/alignment. It filters the existing exact opaque transport-filename alias at this upstream seam. It never reads a target format, UI locale, theme, paper size, output paths or resource availability.

Document AST v2 is plain JSON and contains no provider payload, source resource registry, output profile, theme, front matter, physical policy, copy button, measurement cache or repeated measurement text. One composed JSON tree is accepted by all three backends. Output capability degradation is performed inside a backend without mutating the shared tree.

| Shared document data | Backend decision |
| --- | --- |
| `documentLanguage?: string` | `RenderOptions.locale` selects UI text; HTML omits `lang` when the document language is absent |
| `code.language`, `filename`, `meta`, `showHeader` | Header formatting and HTML copy controls |
| File `label`, `kind`, `mediaType`, `byteLength`, rich `description` | Badge uses only `mediaType` / `kind`, never the label extension; size units/precision and formatted metadata |
| Rich figure/table captions, file descriptions, placeholder details and source headings | Backend styling; PDF retains rich inline nodes, including images |
| Table header/body rows, column index, spans and alignment | GFM rectangular/single-header projection; paged header repetition |
| Message container, author label, source group, disclosure intent | Styles, default disclosure state, responsive prompt folding, message spacing |
| Document header facts/title and optional authored empty notice | Header formatting and localized empty-state defaults |

Content language is never inferred from the export UI locale. For example, a Chinese document can retain `documentLanguage: "zh-CN"` while English UI displays "Sources", "Copy" and "Thinking". When the content language is unknown, the document omits it; backends use their own fallback typography rather than invent a source-language fact.

`header.date` is a unified display date in UTC `YYYY-MM-DD`, not an export date or a raw creation/update timestamp. Composition selects the first valid fact in this fixed order: `updatedAt`, `lastSeen`, `createdAt`, `timestamp`, `chatTime`. Invalid/missing candidates are skipped; the date is omitted when none is valid. Backends format this selected value without reselecting or parsing dates.

HTML generates its DOM IDs from message position and display container; `DisplayMessage.anchor` is absent from the shared contract. Provider-authored model names follow `Provider → DomainMessage.model → DisplayMessage.modelLabel → Renderer`; all three exports display them when present. The unused shared `note` field is removed because production Domain composition never supplied it. PDF may still emit private Typst `note` nodes for disclosures, role labels and source footers. Math source is normalized at the parser/content boundary; the HTML backend typesets it verbatim without trimming or removing dollar delimiters.

## Output context and resource preparation

Resource preparation supplies resource IDs mapped to prepared paths/URLs and compiler byte/blob resolution. Resource identity is carried in display nodes; bytes and output paths remain outside the tree. A backend uses prepared readiness to show unavailable placements and report output diagnostics. It does not acquire resources or deduplicate semantic assets. PDF file cards may display metadata even when file bytes are absent, matching the existing export behavior.

Render options travel beside the document. HTML controls locale, theme, copying and prompt folding. Markdown accepts its export front-matter envelope from orchestration; its backend never reads the source conversation or a clock. PDF controls physical page/bubble/figure policy, table-header repetition, engine math conversion and output diagnostics.

The PDF backend derives spacing, width, automatic keep-with-next and measurement inputs from display nodes. Its private Typst transport may contain resolved print units and derived measurement caches. That transport is not the shared Document AST. Actual fonts, measurement, truncation, wrapping, scaling, positions and page breaks belong to Typst and the renderer. Existing CSS/Typst component styling and PDF default policy values are retained where possible.

## Allowed and forbidden backend decisions

Backends may inspect node types, containers and adjacent display nodes to choose spacing, keep a heading with following content, repeat table headers, measure/truncate a card, scale a figure, perform font/math fallback, or implement a format's capability limits. An explicit author constraint, if supported later, must be distinguishable from these automatic defaults.

Backends must not read Domain or provider payloads; parse message Markdown again; classify provider reasoning; merge legacy resource aliases; or rebind citations. Orchestration parses input, composes Domain once, prepares resources separately and calls a backend with only Document AST, prepared bindings and render options.

## Practical placement questions

1. Does this fact or relationship still hold when changing the output medium? Figure/caption association and heading level do; a 115mm caption cap does not.
2. Should this value change when changing theme, fonts or paper size? If so, it belongs to renderer configuration or layout rather than the common document.

Numeric values are not automatically geometry: logical column indices, spans, heading levels and raw byte lengths are legitimate document data. Replacing all physical numbers with generic style tokens would still leak renderer policy if those tokens merely encode the old backend algorithm.

## Validation and migration status

Contract tests render the same frozen JSON document through all three backends, verify rich table/caption preservation, independent content language/UI locale, raw code/file metadata, backend policy changes without recomposition, JSON roundtrip, input immutability and source-model import/type boundaries. Existing export, real-WASM, stress and visual tests remain regression gates. Backend adjacency inference is explicitly permitted; tests prohibit source-model dependencies rather than physical layout decisions.

D1–D3 isolated backend dependencies. D4 corrects their overly broad policy hoisting and removes the format-specific composer entry points. D5 migrates production HTML/Markdown to Domain-to-document composition, preserving Domain resource IDs and resolving citation markers before Domain. D6 migrates production PDF preparation and payload orchestration to the same direct path. The subsequent cleanup migrated all active callers/tests and removed the obsolete Canonical conversation APIs and input adapters. Raw/Standard/OpenAI JSON remain data archive formats and do not pass through the presentation tree.

## Direct Domain composition (D5)

`chatFormatter.formatHtmlDocument` and `formatMarkdownDocument` parse application input and orchestrate direct HTML/Markdown export. Their former Canonical public names and type aliases are deleted. Its provider/legacy adapter returns a closed Domain graph; `composeDomainDocument` organizes reasoning, content, attachment placement and sources into the shared Document AST. Resources retain Domain IDs, including shared resources referenced in multiple messages. `prepareDomainResources` separately binds those IDs to archive paths; neither Domain nor Document AST stores an export destination.

Citation IDs are message-local Domain relationships. Textual web/grounding markers are resolved by input adapters (including reasoning and rich captions/descriptions); composers consume citation references and never scan text for provider marker syntax. Domain closure rejects duplicate citation IDs and unresolved references. Source UI strings remain backend-local. Authoritative title selection also happens at the legacy boundary rather than selecting raw title candidates during composition.

The only conversation models are Domain facts/relationships and the logical Document AST. Raw/Standard/OpenAI JSON remain archival serializers of input data and are outside the presentation pipeline.

## Resource identity and export destinations

Domain resources carry authored names, provider/document/generation identity, acquisition URIs and intrinsic metadata. Legacy `localName` and export destinations are not semantic identity evidence and are never copied into `source.path` (the field is removed). Renaming or relocating an export cannot change the Domain graph. Destination-only unknown resources use distinct deterministic occurrence identities; they are not merged merely because a filename matches.

`parseLegacyConversation` returns the Domain conversation plus separate resource preparation hints, keyed by Domain resource IDs. The input adapter may use old paths to bind body references, but those aliases do not survive in Domain. HTML/Markdown orchestration passes the transport hints beside Domain into resource preparation. Source URIs, provider tokens and document/generation identities still reconcile aliases before Domain.


## Direct PDF composition (D6)

`preparePdfItem` resolves detail/Takeout input, then calls `parseProviderConversation` before any image byte acquisition. The parser resolves roles, raw/structured bodies, reasoning, citations and resource aliases into Domain; detached Takeout generated-media evidence is reconciled inside this input boundary. It also returns a separate `ResourceAcquisitionHints` sidecar, keyed by Domain asset IDs, carrying transport URI alternatives, provider/generation evidence, candidate URLs and legacy fallback names. These transport hints are not Domain fields or AST nodes; the strict application adapter remains a thin facade. Unknown authored roles survive as `unknown` plus `provenance.rawRole`, and the composer chooses their message heading. Intrinsic byte lengths are established from available input bytes before Domain.

The shared composer returns the same format-neutral Document AST for all three formats. After composition, the shared `collectDocumentResources` walker collects all AST image placements, and `preparePdfResources` acquires those images by Domain asset ID using the sidecar. Different provider/generation identities sharing a URL are acquired independently; repeated references to one asset acquire once. Runtime bytes, media types and acquisition failures enter only `PreparedResources`; they never write back to raw input or pass through `DomainAsset.dataBase64`. Original inline/source bytes may remain input facts and skip acquisition. Acquisition success or failure cannot change Domain or the AST. Export destinations do not determine acquisition grouping or semantic identity.

PDF stages receive Document AST plus prepared resources/options: the resource stage uses the same shared image references for figures and all inline placements, validates image bytes and prepares content-addressed mounts; the payload stage lowers the existing tree to private Typst transport; the compiler sees only transport and validated mount bindings. Rich captions, file descriptions, placeholder details and source headings retain their inline trees in the private Typst transport. Image acquisition, mounting and rendering include every legal image node, even when its parent figure is unavailable. Placeholder references themselves are metadata-only; images inside their details still render. File placements remain metadata-only, and shared bytes mount once. Typst templates render rich fields through the same inline renderer; physical layout policies remain backend-local. Prepared resources and engine wire payloads are transport contexts, not extra conversation representations.


## Test and interface cleanup

Parser corpus evaluation now calls `parseProviderConversation` and compares the returned Content AST arrays directly. Its real-WASM compilation gates compose Domain into Document AST and lower that tree with `renderDocumentTypst`, reusing the exact cached math conversions. Corpus evaluation no longer creates a Canonical conversation bundle. Differential fixtures retain recursive comparisons for formatting, links, math, tables, unknown fields and inline text equivalence.

Parser diagnostics, source references and JSON value types live in content/utilities; export artifact and delivery report types live beside the export pipeline. Production content/provider/PDF modules do not import these types through Canonical. All active parsing, resource, backend and compiler tests now exercise Domain/Document AST or prepared binary transport directly. The Canonical directory, schema, normalizers, composer, renderer adapters, resolver and byte store are removed. Captured external provider fixtures live in `tests/fixtures/provider`; parity/visual corpora contain frozen Document AST and separate resource bindings. PDF direct-export parity uses a frozen historical transport payload, not a retained legacy implementation. Public formatter names are `formatHtmlDocument` and `formatMarkdownDocument`, with no compatibility aliases.

## Diagnostics and fixture contracts

`DocumentDiagnostic` lives in `core/diagnostics/documentDiagnostic.ts`. Parsing, preparation and rendering return diagnostics beside their result or emit them through callbacks; neither Domain nor Document AST carries them.

File badges use explicit media-type/kind mappings (PDF, DOCX, XLSX, PPTX and other common formats). Unknown types fall back to FILE/IMAGE/AUDIO/VIDEO. Filenames never determine the badge.

Visual and parity JSON fixtures are compiled as fresh typed literals against the current `DocumentAst` definition before rendering. This catches excess properties recursively (including obsolete `anchor`), missing fields and invalid variants/types; JSON imports and type assertions alone do not supply this check. The independent contract suite also validates composed Domain fixtures and includes rejection tests.
