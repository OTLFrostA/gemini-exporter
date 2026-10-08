# Domain model and upstream parsing boundary

Domain is the provider-neutral semantic conversation we intend to remember over time. It owns source facts and relationships, independently of the current exporter or storage implementation. The target producer pipeline is `raw input → source parser → Domain`. Consumers then use `Domain → Document AST → Renderer`.

Production conversation detail inputs now follow raw source → native parser → Domain: RPC pages, Takeout archives and DOM observations. Runtime application envelopes carry the native result in a `parsed` sidecar. Versioned storage receives Domain directly. JSON/application consumers receive a one-way string-record projection; a dedicated legacy-storage parser interprets historical persisted records.

## Shared parser contract

`src/core/parsers/contracts.ts` defines `ConversationParseContext`, `ConversationParseResult` and `ConversationParser<Raw>`:

```ts
interface ConversationParseContext { providerId: string }
interface ConversationParseResult {
  conversation: DomainConversationDetail;
  diagnostics: DocumentDiagnostic[];
}
```

Each source parser accepts its own raw schema and supplies a closed Domain graph, synchronously or asynchronously. New parsers require explicit provider identity. An import format and the content provider are different facts: Gemini live and Takeout both use `gemini`. Compatibility records may preserve other provider identities without implying that their raw archive formats are supported. Diagnostics describe problems with a parse attempt; they are never fields of Domain or Content/Document AST.

`parseConversation` in `src/core/parsers/parseConversation.ts` dispatches implemented raw formats: `gemini-rpc`, `gemini-takeout`, asynchronous `gemini-takeout-zip`, and `gemini-dom`. Historical storage enters only through `legacy-storage`, whose parser owns the neutral `ConversationRecordInput` decoding boundary. Normal runtime and export cannot select a historical conversation record as an input format. All producers return Domain with diagnostics and asset-keyed resource/acquisition evidence beside it.

HTML/Markdown orchestration, PDF preparation, live save, pagination and detail transport consume `ResourceConversationParseResult` directly. They never reconstruct a `Conversation + parsed` application object. Source-string provider inference stays beside the historical record boundary for migration tests; raw parsers use explicit formats. Unsupported formats are rejected.

When a raw producer migrates, add its explicit format and raw schema to this dispatcher and implement its parser against the shared result contract. That parser must construct Domain from source evidence directly, without first constructing the persisted `Conversation` or a renderer model. Archive lookup or asynchronous decoding can happen inside its parser; it does not require another semantic model.

## Gemini raw RPC boundary

`parsers/gemini/rpc/parseConversation.ts` constructs Domain directly from source evidence returned by `parsers/gemini/rpc/detailDecoder.ts::decodeGeminiDetail`. This shared decoder extracts the current wire grammar once. Its types live in `parsers/gemini/rpc/detailEvidence.ts` and do not depend on the persisted `Conversation`/`Message` contract. Production list callers import the native `parseList` directly. Application detail result types live in `api/client/detailTypes.ts` and carry the native parse result, including separate pagination/debug transport evidence. The historical detail facade and its media-name projection are removed. `decodeGeminiDetail` uses source-only image extraction: it contains no export paths, synthesized anonymous filenames or altered acquisition URLs. The native parser never calls the compatibility projection or record parser.

The native parser preserves messages/candidates, body/reasoning, citations, structured resources, source dates, metadata-only titles and the original request tokens. Historical normalized lookup keys and archive destinations remain compatibility/preparation hints. Model names pass through when source evidence exposes them; this change does not guess an undocumented model slot.

A result covers one decoded detail page. Remaining pagination or rejected source turns imply partial coverage; an absent cursor leaves completeness unknown. `transport` carries pagination, schema warnings and decoded/debug payloads beside Domain. Diagnostics also remain outside the graph. Client fetch and network interception use the native parser. Pagination merges Domain messages, resource registries and diagnostics, remaps colliding page-local asset identities and marks token-loop/page-limit truncation explicitly. Synthetic envelopes plus existing sanitized wire fixtures verify offline semantic parity. The complete logged-in Chrome Tier 2 run on 2026-10-07 also passed all 24 features, including real generation, pagination, import and physical exports; see [the acceptance record](audits/native-domain-parser-tier2.md). This evidence covers the exercised live sources, not all future wire variants.

## Gemini Takeout raw boundary

`gemini-takeout-zip` performs archive loading, existing ZIP/HTML size checks, activity selection and source decoding inside the parser. The configured JSZip reader or an injected archive reader loads bytes; it does not return stored application conversations. Archives with several activities or conversations require explicit selection, while `parseGeminiTakeoutZipArchive` returns a batch of closed Domain results. `gemini-takeout` accepts the same source HTML plus archive inventory for callers that already have them.

`decodeHtml.ts` shares the historical prompt/date helpers while decoding native activity facts without export names. ZIP entry paths and filenames are source facts, unlike new export destinations. Exact archive paths, a unique basename or unique extension/name variants can resolve an explicit media reference; ambiguous matches and missing files retain semantic resource records with diagnostics. Media in the explicit prompt region belongs to the user; response media belongs to the assistant. A repeated preview of an explicitly owned URI is the same resource, not a second unbound asset. Uncertain ownership retains an unbound resource instead of fabricating a message relationship. File handles travel beside Domain in `archiveResources`, keyed by asset ID. No native export path is allocated during parsing.

MyActivity records partial activity coverage, not a complete transcript. Native messages use only explicit prompt evidence and source event dates; they do not fabricate request/message/document IDs, assistant dates by adding two seconds, or research-report attachments from a long heading. Authored reports become Content AST. A source-recorded media generation event remains in `DomainMessage.generation` (`mediaKind`, optional `outputCount`) even when output files are absent; this neutral event differs from resource-level generation identity. Unreferenced watermarked filenames and ZIP dates do not establish generation ownership.

The production import/cache/storage path keeps its compatibility API around native parsing. The complete Tier 2 run verified Takeout import, history synchronization, authoritative title upgrades and combined physical exports; offline HTML/ZIP contracts cover additional source shapes.

## What Domain remembers

- Conversation and message identities, normalized roles, provider-authored model names, source timestamps, title evidence, and source provenance.
- Authored body content and provider-exposed reasoning as Content AST, including unknown content with a readable bounded fallback.
- Message-local citations and the content references that identify them.
- Semantic resources and explicit message/resource relationships, including source metadata, document metadata and generation evidence.
- Known completeness of the source conversation. A successful parse does not establish that the source supplied all messages.

`DomainConversationDetail.provenance.source` preserves an opaque source-origin label such as `takeout` or `openai-import`; it does not replace `providerId`. Message request provenance remains opaque provider metadata. Do not infer parent/child relationships from a request ID, Gemini turn token, filename or array position.

`completeness.status` is `complete`, `partial` or `unknown`; omission also means unknown. `reason` preserves a source explanation. Explicit truncation or a remaining pagination cursor is evidence of partial coverage and overrides a conflicting complete claim. A false truncation flag or absent cursor alone is not proof of completeness. Cursors and raw truncation aliases never become Domain fields.

Message timestamps are finite Unix epoch milliseconds, omitted when unknown. The required conversation `timestamp` is finite milliseconds or null; non-finite record values become null before JSON serialization. The existing conversation aliases (`chatTime`, `lastSeen`, `href`) and number/string metadata remain compatibility debt. They are not a template for new source-specific aliases. Normalize raw timestamp units in each source parser, distinguish source dates from local observation dates, and resolve URL aliases there. Removing those existing Domain aliases requires a separate consumer migration; this phase does not alter their export behavior.

Domain does not own diagnostics, pagination state, source debugging payloads, export destinations, acquired export bytes, layout preferences or renderer labels. Existing source-unavailability facts on resources differ from a failure during a new export attempt: the latter belongs to preparation diagnostics. Do not add a generic raw-field bag to Domain to avoid deciding which source facts matter.

## Closed resource graph

Each semantic resource has one `DomainAsset` record. Every image/file `assetId` in body or reasoning and every `attachmentIds` entry refers to that registry. Explicit attachment relationships preserve source order. A body-only resource does not acquire another explicit attachment relationship merely because it appears in content. A resource can be referenced by several messages, and its record preserves the union of known semantic metadata.

Producer adapters reconcile attachments, images, documents, structured-body evidence, generated-media evidence and body/reasoning references. Deduplication requires source references, document identity, provider tokens or reliable generation identity. A matching filename alone does not prove identity. Conflicting identities and unknown image ordinals remain distinct. Source-less parallel aliases can reconcile within one message without establishing identity across messages.

Asset IDs are opaque and independent of export numbering. Known source/document/generation evidence yields deterministic IDs; ambiguous resources get distinct minted IDs. IDs survive JSON serialization. Changing message order does not change identities supported by unambiguous source evidence.

Asset kind, name, media type, byte length, dimensions, source failure information and generation metadata are semantic facts. Document IDs, creation times, chip URLs, sections, links, extracted Markdown, candidates and fabrication flags belong to the resource. Original inline bytes can be detached as base64 input facts; bytes acquired during export belong only to PreparedResources.

`source.uri` identifies the original source/acquisition URI. Export destinations and historical `localName` belong in independent preparation hints. Domain contains no export filenames, storage handles, layout state or per-provider resource aliases.

`assertDomainClosure` checks provider identity, primary timestamp and completeness validity, resource/citation identities and references, and repeated attachment relationships. It is a graph guard, not a complete runtime schema validator. Strict TypeScript contracts and parser tests cover the source-to-Domain construction boundary.

## Consumer boundary

The composer consumes Domain directly. It binds citations, organizes disclosures and sources, places explicit attachments not already referenced in content/reasoning, and returns one format-neutral Document AST. It never parses provider markup or reconstructs raw source evidence. Consumers preserve Domain identities and do not mutate the conversation.

Resource/acquisition hints travel beside Domain, keyed by asset ID. HTML/Markdown preparation binds resources to archive destinations. PDF acquires all images referenced by the Document AST, including images nested in rich inline fields, and validates/mounts their bytes. Acquisition outcomes cannot change Domain or Document AST.

## Migration order and acceptance

| Input | Current producer | Next migration requirement |
| --- | --- | --- |
| Historical storage records | `parsers/legacyStorage/parseConversation.ts`, reusing the characterized record grammar | Only upgrade migration may decode this shape; runtime and export require native bodies. |
| Gemini RPC/JSPB | `parsers/gemini/rpc/parseConversation.ts`, client, network hook and native pagination | Production callers, offline fidelity tests and the complete live Tier 2 acceptance run are verified. |
| Gemini Takeout HTML/archive | `parsers/gemini/takeout/parseConversation.ts` and `parseZip.ts`, import/acquisition adapter | Import builds Domain directly and stores native results with source-bound resource context. Explicit asset/file bindings and the complete live Tier 2 import/export flow are verified. |
| Live DOM observations | `parsers/gemini/dom/parseConversation.ts`, `content/domScraper.ts` acquisition adapter | Authored DOM trees preserve rich content without string truncation or nested-node duplication. Coverage stays partial. |

OpenAI archive import is not implemented. The unvalidated exploration prototype and its synthetic parser tests have been removed; OpenAI import is outside the current parser migration scope. Existing OpenAI-compatible JSON export and generic record compatibility remain separate capabilities.

The currently linear message list is not a complete branching/tool execution model. Before migrating an input that contains those facts, extend the semantic contract and consumer projection together; do not silently discard non-selected branches or tool messages to fit today's renderer. Unsupported information must remain an explicit migration issue rather than being called complete support.

Each migration needs source-specific fidelity tests, stable identities, closure checks, JSON round trips, diagnostics outside Domain, and unchanged downstream export semantics. Synthetic contracts do not establish provider wire compatibility.

## Durable storage boundary

The separately authorized storage upgrade adopts a versioned Domain repository.
Native captures write structured Domain directly; old chrome/IndexedDB records
are explicit legacy-storage parser inputs, backed up before interpretation and
transfer. The lightweight conversation index and independent settings/account/
export APIs retain their existing keys. Runtime string projections are not the
new durable body. See [Domain storage contract and upgrade behavior](domain-storage.md).

Raw source parsers remain independent of storage. Only the legacy-storage parser
uses the characterized historical record grammar; migration I/O belongs to the
storage layer. Ambiguous account ownership is preserved and reported, not guessed.

## Physical ownership and verification

Source parsers and the common parsing contracts live in `src/core/parsers/`; Content AST lives under Domain. Document AST, composition and rendering have separate directories. Legacy Gemini media utilities live under `compatibility/gemini/`; output naming belongs to resource preparation, independently of the raw wire decoder. Pure ZIP validation accepts an optional error translator; the existing UI supplies it from `compatibility/archive/` without making native parsers load storage through the language module. MiTeX's notation compatibility lives in a neutral utility, so renderers do not load the Gemini parser registry.

Gemini RPC, Takeout and DOM conversation producers now use native Domain in production. `compatibility/record` owns historical storage grammar and the final OpenAI JSON projection; the application projection APIs and compatibility parser facades are removed. Source list/sidebar readers remain metadata indexing APIs, not full transcript parsers. OpenAI archive import remains absent. The complete Tier 2 run passed all 24 features on 2026-10-07, with no failures, skips or warnings; [the acceptance record](audits/native-domain-parser-tier2.md) describes its scope.

Takeout does not associate unreferenced watermarked files with a conversation merely by C2PA/ZIP time proximity. Authored generation events stay in Domain, archive bytes stay in acquisition context, and unresolved ownership is diagnosed. This intentionally replaces the old time-correlation behavior. Native export callers cannot run the legacy media supplement or report-fabrication heuristic. Native parse diagnostics reach import logs and export drift metadata; partial source coverage is never labeled a complete export.

Live image saving can change prepared archive destinations after byte sniffing; it updates asset-keyed resource hints without rewriting the native content or source URI. High-resolution URL preparation also stays outside the source parser.

The parser migration acceptance above predates the separate storage upgrade. Current durable storage and its upgrade validation are documented in [Domain storage](domain-storage.md).

## Takeout archive resource resolution

Native ZIP parsing retains the selected MyActivity entry path, including the `My Activity/Gemini Apps` layout. Resource lookup first tries the HTML directory plus the decoded reference, then the archive-root path, then a unique basename. Further unique-only tiers compare the complete filename stem for missing or changed extensions and Takeout name variants (`|` to `_`, trailing `.synced` removed). Hashes are preserved; case folding, prefix matching and first-candidate selection are not used. Any tier with multiple candidates stops with an ambiguity diagnostic. Filename fallback emits a sidecar diagnostic and never changes the literal archive path or invents an export destination.

HTML image references retain their image and generation evidence even when the matching archive entry lacks an image extension. The reference's extension is not proof of the acquired bytes' media type; acquisition still validates the bytes. Archive handles remain outside Domain. A local extracted Takeout audit contained 186 files and 176 unique bare resource references: 158 resolved relative to MyActivity, 16 by extension fallback, and two by Takeout name normalization, with no missing or ambiguous resources. All 1049 parsed conversations passed resource closure and JSON round-trip checks. Every one of the 176 resources, including seven audio files, had a message relation, a Document AST reference and readable archive bytes. Import projection remained metadata-only. Only anonymized filename shapes are committed as regression contracts; the personal archive stays local. This local archive audit complements the separately completed Tier 2 run.


JSON export has two public outputs. Complete JSON uses `{ format: 'gemini-exporter-domain', version: 1, conversation, resources? }`, preserving the full Domain and optional asset destinations without storage or transport implementation state. OpenAI-compatible JSON converts native messages at the final serialization boundary into role/content records with image parts and reasoning text. It is an interoperability view, not a lossless backup or a promise of ChatGPT import support. The historical string projector is used only by this output serializer. Developer raw JSON requires actual decoded provider evidence.
