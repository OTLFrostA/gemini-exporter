# ChatGPT component source parsing

ChatGPT educational answers may contain DIL component source alongside provider-generated Markdown. The parser now reads the source first and renders supported components in source order. Provider Markdown is a fallback, rather than the default replacement followed by an unordered list of recovered strings.

## Supported static representations

| Module | Export behavior |
| --- | --- |
| Layout (`box`, `row`, `column`, `grid`, `grid-item`, text/labels, titles, emphasis, divider) | Ordered Markdown content; visual layout properties are not reproduced. |
| Literal bindings, `DIL.useState(initial)`, indexed/member expressions | Bounded data interpretation. State uses the declared initial value, not the live browser state. |
| `each`, nested `if`/`else` | Expand referenced fields in place; repeated labels remain repeated. Unused object fields are not exported. |
| Radio, checkbox, select/option, input, button | Static labels, placeholder and button text. No current selection or event behavior is claimed. |
| `CodeBlock` | Exact code body inside a safe Markdown fence, retaining language and indentation. |
| `AsyncImage` | Existing image-gallery binding resolves the query against captured component results; this module does not invent asset URLs. |
| SVG | Preserve SVG source as a code fence, with common React attribute names normalized. This is not a rendered diagram. |
| `LearningViz` | `VARIANCE` and `ANGULAR_FREQUENCY_RELATION` have static descriptions and captured initial values. This is not an interactive chart. |

Ordinary Markdown code and math are opaque to component parsing. No provider JavaScript, handler, arbitrary call, getter or prototype access is executed. Input size, nesting, expression work, loop expansion and output are bounded. Unsupported syntax fails to explicit fallback or an incomplete-content diagnostic.

## Fallback and completeness

An unsupported block uses its provider Markdown segment when neighboring text uniquely identifies the boundaries. Ambiguous boundaries use the whole provider fallback and report that representation. A source/fallback content guard also retains the whole fallback if parsed output would lose provider text. Missing fallback produces an unavailable-component marker and incomplete status.

`modules`, `fallbackBlocks` and `unsupported` diagnostics describe which route was used. Completeness measures static textual coverage; it never promises interactive behavior, live selection state, or exact visual reproduction. Branch integrity and stream completion still independently determine conversation quality.

## Evidence and verification

`tests/fixtures/chatgpt_dil_corpus.json` contains 68 unique retained educational test answers, with raw source and provider fallback. The captures came from 12 retained Tier 2 source exports; identifiers were removed. These are synthetic educational conversations, not standards or an exhaustive inventory of ChatGPT components.

The corpus regression requires every captured answer to parse without fallback and compares the source-only result to the result when fallback is present. Separate assertions check original code bodies, questionnaire question/choice ordering, six Helmholtz checklist labels before the conclusion, nested control flow, unknown components and interpreter safety. The existing captured compost questionnaire also exercises the full conversation parser and quality classification.

Offline production exports of the questionnaire and full Helmholtz report were checked in Markdown, HTML and real WASM-compiled PDF. All six PDF pages and the HTML questionnaire/report/checklist were visually inspected. This verification makes no ChatGPT network calls and does not claim a new live Tier 2 pass. New component families need their own captured source fixtures and explicit static representations.
