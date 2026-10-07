# Document AST and rendering boundary

A semantic conversation describes facts and relationships. A Document AST describes what a particular export presents. The output engine measures, wraps, paginates and encodes that presentation.

```text
provider / legacy adapter -> Domain -> Canonical (temporary compatibility seam)
                                                  |
resource preparation -> bindings/readiness -> composer
                                                  |
                                             Document AST
                                                  |
                                     backend + resource bindings
```

## Ownership

- Domain owns provider identity, content, reasoning, citations, stable asset identity and authored metadata. It owns no bubbles, disclosure state, captions inferred for display, CSS, output paths or page geometry.
- The composer selects a versioned export profile, document metadata, message containers, folding, disclosure titles/states, code headers/actions, captions/labels, source groups/marker labels, missing-resource presentation and effective table alignment.
- Resource preparation owns acquisition, bytes, output paths and verified availability. Bindings contain the paths the backend may use; they do not contain semantic assets. A rendering tree can repeat a resource reference many times without duplicating its semantic identity.
- The backend consumes only Document AST and bindings. It emits markup, escapes unsafe values, executes declared controls/styles and typesets mathematics. Backend math failures remain backend diagnostics; source/caption/missing-resource diagnostics are produced by composition.

The AST is plain JSON, with an explicit schema and profile version. No functions, Maps, Dates, source registry or pre-rendered HTML are stored in it. The profile id defines component styling; geometry is not stored. It is deliberately a presentation tree, rather than Canonical with more optional fields.

## HTML presentation example

```json
{
  "type": "message",
  "id": "m1",
  "anchor": "turn-user-0",
  "variant": "bubble",
  "folding": { "initiallyCollapsed": true, "moreLabel": "Show more", "lessLabel": "Show less" },
  "blocks": [
    { "type": "paragraph", "children": [{ "type": "text", "text": "A long question" }] },
    { "type": "image", "resourceId": "a1", "alt": "Diagram", "caption": [{ "type": "text", "text": "123" }] }
  ],
  "sources": { "type": "sources", "items": [{ "id": "c1", "label": "Reference", "href": "https://example.com" }] }
}
```

An unavailable image becomes an explicit placeholder during composition; the serializer cannot substitute a different fallback. Authored captions (including numeric captions) are content, not opaque filename candidates. The temporary compatibility seam filters only an exact opaque asset filename copied verbatim into a plain caption/alt. Domain provenance must eventually make that distinction explicit. Colspan/rowspan occupancy and effective cell alignment are resolved before HTML serialization.

## Migration status and compatibility

Phase D1 migrates every production HTML call through the existing `renderCanonicalHtml` / `CanonicalHtmlRenderer` orchestration facade to `composeHtmlDocument` and `renderDocumentHtml`. Those facade names remain for callers; they are not the pure backend contract. The production facade declares its archive paths through a resolver, while a resolver that returns null produces an unavailable placement. Companion plans and rendered paths now derive from the same resolution results.

Canonical remains a temporary semantic input seam. Its reasoning insertion, attachment-tail placement, legacy adapters and citation binding are still upstream work. Domain is not yet declared frozen. Phase D2 also migrates Markdown through `composeMarkdownDocument` and `renderDocumentMarkdown`. HTML and Markdown share content composition and have explicit profile policies. Typst/PDF retains its existing route until D3. JSON archive formats are not presentation exports and do not pass through this tree.

HTML's existing profile and CSS remain largely intact; caption preservation and logical table alignment deliberately improve content fidelity. PDF payloads, templates, fonts, acquisition and pagination are unchanged in D1. Each subsequent profile should declare its capabilities and degradation policies rather than let a backend infer presentation from provider facts.

## Contract checks

Tests cover immutable input, deterministic composition, JSON roundtrip, repeated resource occurrences, nested content, missing resources, source groups, table occupancy, URL/text escaping, direct AST policy changes, type/import boundaries and production integration. The composer is the place to change presentation policy; the serializer is the place to change output syntax or backend mechanics.

## Markdown profile

The composer supplies ordered front matter, an explicit export time, message headings, source headings/prefixes, disclosure state and visible missing-resource placements. The compatibility facade captures the clock once; composing and serializing a saved tree is deterministic. Only prepared archive-relative resources are eligible for embedding.

GFM capability limits are resolved during composition: the table has exactly one header row, extra headers become body rows, spans become a complete rectangular grid with empty continuation cells, and effective column alignment is explicit. The backend encodes this declared grid and handles Markdown fences, escaping and GFM pipe/backslash syntax. It performs no semantic lookup or layout projection. Authored numeric/rich captions survive unchanged.
