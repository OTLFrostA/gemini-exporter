# Document AST and rendering boundary

**A renderer must not reinterpret source semantics. A renderer may perform layout.**

Provider/legacy adapters parse and reconcile external inputs into Domain facts and relationships. The composer selects content, organizes the logical document and declares product presentation intent. A format-neutral Document AST is then rendered through HTML, Markdown or PDF backends. HTML and Markdown now compose directly from Domain. Canonical remains a temporary compatibility seam for PDF and the older canonical API; it is not part of the direct HTML/Markdown pipeline.

```text
raw input -> provider / legacy parser -> Domain
                                          |
                      +-------------------+-------------------+
                      |                                       |
              direct composer                       Canonical compatibility
                      |                              (PDF migration pending)
                      |                                       |
                      |                                compatibility composer
                      +-------------------+-------------------+
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
| `documentLanguage?: string` | `RenderOptions.locale` selects UI text; engine maps content language to typography |
| `code.language`, `filename`, `meta`, `showHeader` | Header formatting and HTML copy controls |
| File `label`, `kind`, `mediaType`, `byteLength`, rich `description` | Badge, size units/precision and formatted metadata |
| Rich figure/table captions | PDF plain-text degradation |
| Table header/body rows, column index, spans and alignment | GFM rectangular/single-header projection; paged header repetition |
| Message container, author label, source group, disclosure intent | Styles, default disclosure state, responsive prompt folding, message spacing |
| Document header facts/title and optional authored empty notice | Header formatting and localized empty-state defaults |

Content language is never inferred from the export UI locale. For example, a Chinese document can retain `documentLanguage: "zh-CN"` while English UI displays "Sources", "Copy" and "Thinking". When the content language is unknown, the document omits it; backends use their own fallback typography rather than invent a source-language fact.

## Output context and resource preparation

Resource preparation supplies resource IDs mapped to prepared paths/URLs and compiler byte/blob resolution. Resource identity is carried in display nodes; bytes and output paths remain outside the tree. A backend uses prepared readiness to show unavailable placements and report output diagnostics. It does not acquire resources or deduplicate semantic assets. PDF file cards may display metadata even when file bytes are absent, matching the existing export behavior.

Render options travel beside the document. HTML controls locale, theme, copying and prompt folding. Markdown accepts its export front-matter envelope from orchestration; its backend never reads the source conversation or a clock. PDF controls physical page/bubble/figure policy, table-header repetition, engine math conversion and output diagnostics.

The PDF backend derives spacing, width, automatic keep-with-next and measurement inputs from display nodes. Its private Typst transport may contain resolved print units and derived measurement caches. That transport is not the shared Document AST. Actual fonts, measurement, truncation, wrapping, scaling, positions and page breaks belong to Typst and the renderer. Existing CSS/Typst component styling and PDF default policy values are retained where possible.

## Allowed and forbidden backend decisions

Backends may inspect node types, containers and adjacent display nodes to choose spacing, keep a heading with following content, repeat table headers, measure/truncate a card, scale a figure, perform font/math fallback, or implement a format's capability limits. An explicit author constraint, if supported later, must be distinguishable from these automatic defaults.

Backends must not read Domain, Canonical or provider payloads; parse message Markdown again; classify provider reasoning; merge legacy resource aliases; or rebind citations. Compatibility facades may receive Canonical to prepare resources, compose once and delegate, but they are orchestration rather than backend APIs.

## Practical placement questions

1. Does this fact or relationship still hold when changing the output medium? Figure/caption association and heading level do; a 115mm caption cap does not.
2. Should this value change when changing theme, fonts or paper size? If so, it belongs to renderer configuration or layout rather than the common document.

Numeric values are not automatically geometry: logical column indices, spans, heading levels and raw byte lengths are legitimate document data. Replacing all physical numbers with generic style tokens would still leak renderer policy if those tokens merely encode the old backend algorithm.

## Validation and migration status

Contract tests render the same frozen JSON document through all three backends, verify rich table/caption preservation, independent content language/UI locale, raw code/file metadata, backend policy changes without recomposition, JSON roundtrip, input immutability and source-model import/type boundaries. Existing export, real-WASM, stress and visual tests remain regression gates. Backend adjacency inference is explicitly permitted; tests prohibit source-model dependencies rather than physical layout decisions.

D1–D3 isolated backend dependencies. D4 corrects their overly broad policy hoisting and removes the format-specific composer entry points. D5 migrates production HTML/Markdown to Domain-to-document composition, preserving Domain resource IDs and resolving citation markers before Domain. The next remaining production migration is PDF resource preparation and payload orchestration; after that, obsolete Canonical conversation APIs and input adapters can be removed. Raw/Standard/OpenAI JSON remain data archive formats and do not pass through the presentation tree.

## Direct Domain composition (D5)

`chatFormatter` retains its legacy public function names but no longer constructs a Canonical bundle for HTML/Markdown. Its provider/legacy adapter returns a closed Domain graph; `composeDomainDocument` organizes reasoning, content, attachment placement and sources into the shared Document AST. Resources retain Domain IDs, including shared resources referenced in multiple messages. `prepareDomainResources` separately binds those IDs to archive paths; neither Domain nor Document AST stores an export destination.

Citation IDs are message-local Domain relationships. Textual web/grounding markers are resolved by input adapters (including reasoning and rich captions/descriptions); composers consume citation references and never scan text for provider marker syntax. Domain closure rejects duplicate citation IDs and unresolved references. Source UI strings remain backend-local. Authoritative title selection also happens at the legacy boundary rather than selecting raw title candidates during composition.

The old Canonical composer delegates logical block composition to the same `contentComposer` while its remaining PDF/API callers migrate. That compatibility path may rename references for its historical schema, but the direct HTML/Markdown path never uses it. No additional conversation representation is introduced. Raw/Standard/OpenAI JSON remain archival serializers of input data and are outside the presentation pipeline.

## Resource identity and export destinations

Domain resources carry authored names, provider/document/generation identity, acquisition URIs and intrinsic metadata. Legacy `localName` and export destinations are not semantic identity evidence and are never copied into `source.path` (the field is removed). Renaming or relocating an export cannot change the Domain graph. Destination-only unknown resources use distinct deterministic occurrence identities; they are not merged merely because a filename matches.

`parseLegacyConversation` returns the Domain conversation plus separate resource preparation hints, keyed by Domain resource IDs. The input adapter may use old paths to bind body references, but those aliases do not survive in Domain. HTML/Markdown orchestration passes the transport hints beside Domain into resource preparation. Source URIs, provider tokens and document/generation identities still reconcile aliases before Domain.
