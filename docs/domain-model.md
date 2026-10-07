# Domain model and upstream parsing boundary

Domain is the provider-neutral semantic conversation we intend to remember over time. It owns source facts and relationships, independently of the current exporter or storage implementation. The target producer pipeline is `raw input → source parser → Domain`. Consumers then use `Domain → Document AST → Renderer`.

This phase establishes the shared parsing contract and entry point. It does **not** migrate the existing raw producers or storage. A historical application record is explicitly a migration bridge, not a raw decoder.

## Shared parser contract

`src/core/domain/parsing.ts` defines `ConversationParseContext`, `ConversationParseResult` and `ConversationParser<Raw>`:

```ts
interface ConversationParseContext { providerId: string }
interface ConversationParseResult {
  conversation: DomainConversationDetail;
  diagnostics: DocumentDiagnostic[];
}
```

Each source parser accepts its own raw schema and supplies a closed Domain graph, synchronously or asynchronously. New parsers require explicit provider identity. An import format and the content provider are different facts: Gemini live and Takeout use `gemini`, while OpenAI archives use `openai`. Diagnostics describe problems with a parse attempt; they are never fields of Domain or Content/Document AST.

`parseConversation` in `src/core/provider/parseConversation.ts` dispatches implemented input formats. Today its only format is `conversation-record`, accepting `ConversationRecordInput` from `provider/record`. This neutral name replaces the common parser's dependence on `GeminiNormalizationInput`; the old Gemini names remain type aliases for compatibility. The record parser returns the shared semantic result plus independent, asset-keyed resource/acquisition hints required by existing export callers.

HTML/Markdown application adapters and PDF preparation enter through this function. `parseProviderConversation` remains a compatibility wrapper for existing callers and tests. Source-string provider inference is isolated in that wrapper's module; it is not a rule for new raw parsers. Unsupported formats are rejected rather than routed through a guessed decoder.

When a raw producer migrates, add its explicit format and raw schema to this dispatcher and implement its parser against the shared result contract. That parser must construct Domain from source evidence directly, without first constructing the persisted `Conversation` or a renderer model. Archive lookup or asynchronous decoding can happen inside its parser; it does not require another semantic model.

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
| Existing application/cache records | `provider/record/parseConversationRecord.ts` | Keep the compatibility bridge until callers no longer need the persisted shape. |
| OpenAI archive JSON | `engine/takeout/openaiParser.ts` | Decode raw records directly; preserve author/model facts, creation time, all meaningful roles and source node identities. Specify branching and tool-call/result relationships before projecting a selected path. |
| Gemini RPC/JSPB | `api/parser/parseDetail.ts` | Construct Content AST and resource/citation identities from wire evidence; preserve pagination/truncation semantics and exposed reasoning/model facts. Verify with real payload evidence and Tier 2. |
| Gemini Takeout HTML/archive | `engine/takeout/takeoutHtmlParser.ts` | Construct Domain from HTML plus archive evidence; keep resource lookup context separate, preserve generated-media and document facts. Verify Tier 2 import/export. |
| Live DOM observations | `content/domScraper.ts` | Distinguish an observed fragment from a complete conversation; preserve authored content and provenance independently of DOM layout. |

The currently linear message list is not a complete branching/tool execution model. Before migrating an input that contains those facts, extend the semantic contract and consumer projection together; do not silently discard non-selected branches or tool messages to fit today's renderer. Unsupported information must remain an explicit migration issue rather than being called complete support.

Each migration needs source-specific fidelity tests, stable identities, closure checks, JSON round trips, diagnostics outside Domain, and unchanged downstream export semantics. Synthetic contracts do not establish provider wire compatibility.

## Storage boundary for this work

No storage implementation, persisted `src/types/conversation.ts` shape, key, serializer, version or migration is changed. Existing fetch/sync/import flows still deliver their historical records to storage. The unified parser runs at the current Domain-facing boundary. Choosing Domain as the future durable semantic model does not authorize writing it into today's storage.

Storage adoption will be handled separately with an explicit versioned compatibility design and upgrade tests. Raw parser migrations must not opportunistically change existing storage callers or reinterpret old persisted records.
