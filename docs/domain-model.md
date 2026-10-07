# Domain model and upstream parsing boundary

Domain is the provider-neutral semantic conversation we intend to remember over time. It owns source facts and relationships, independently of the current exporter or storage implementation. The target producer pipeline is `raw input → source parser → Domain`. Consumers then use `Domain → Document AST → Renderer`.

The shared parsing contract now includes a direct Gemini detail RPC parser. Fetch/sync/storage callers still use their existing compatibility outputs; migrating those callers remains separate. A historical application record is explicitly a migration bridge, not a raw decoder.

## Shared parser contract

`src/core/parsers/contracts.ts` defines `ConversationParseContext`, `ConversationParseResult` and `ConversationParser<Raw>`:

```ts
interface ConversationParseContext { providerId: string }
interface ConversationParseResult {
  conversation: DomainConversationDetail;
  diagnostics: DocumentDiagnostic[];
}
```

Each source parser accepts its own raw schema and supplies a closed Domain graph, synchronously or asynchronously. New parsers require explicit provider identity. An import format and the content provider are different facts: Gemini live and Takeout use `gemini`, while OpenAI archives use `openai`. Diagnostics describe problems with a parse attempt; they are never fields of Domain or Content/Document AST.

`parseConversation` in `src/core/parsers/parseConversation.ts` dispatches implemented input formats. It accepts `gemini-rpc` raw response text, `gemini-takeout` raw HTML/archive context, `gemini-takeout-zip` raw ZIP bytes (async), and `conversation-record` compatibility input from `compatibility/record`. This neutral name replaces the common parser's dependence on `GeminiNormalizationInput`; the old Gemini names remain type aliases for compatibility. The record parser returns the shared semantic result plus independent, asset-keyed resource/acquisition hints required by existing export callers.

HTML/Markdown application adapters and PDF preparation enter through this function. `parseProviderConversation` remains a compatibility wrapper for existing callers and tests. Source-string provider inference is isolated in that wrapper's module; it is not a rule for new raw parsers. Unsupported formats are rejected rather than routed through a guessed decoder.

When a raw producer migrates, add its explicit format and raw schema to this dispatcher and implement its parser against the shared result contract. That parser must construct Domain from source evidence directly, without first constructing the persisted `Conversation` or a renderer model. Archive lookup or asynchronous decoding can happen inside its parser; it does not require another semantic model.

## Gemini raw RPC boundary

`parsers/gemini/rpc/parseConversation.ts` constructs Domain directly from source evidence returned by `parsers/gemini/rpc/detailDecoder.ts::decodeGeminiDetail`. This shared decoder extracts the current wire grammar once. Its types live in `parsers/gemini/rpc/detailEvidence.ts` and do not depend on the persisted `Conversation`/`Message` contract. The historical `parseDetail` uses the shared wire decoder with its compatibility media-name policy, then `legacyDetailProjection.ts` adds archive paths, high-resolution acquisition URLs and unique sanitized names. Its output stays unchanged. `decodeGeminiDetail` uses source-only image extraction: it contains no export paths, synthesized anonymous filenames or altered acquisition URLs. The native parser never calls the compatibility projection or record parser.

The native parser preserves messages/candidates, body/reasoning, citations, structured resources, source dates, metadata-only titles and the original request tokens. Historical normalized lookup keys and archive destinations remain compatibility/preparation hints. Model names pass through when source evidence exposes them; this change does not guess an undocumented model slot.

A result covers one decoded detail page. Remaining pagination or rejected source turns imply partial coverage; an absent cursor leaves completeness unknown. `transport` carries pagination, schema warnings and decoded/debug payloads beside Domain. Diagnostics also remain outside the graph. Pagination aggregation and production caller migration have not been switched. Synthetic envelopes plus existing sanitized wire fixtures verify offline semantic parity, not live RPC compatibility; Tier 2 remains pending until a logged-in debug Chrome is available.

## Gemini Takeout raw boundary

`gemini-takeout-zip` performs archive loading, existing ZIP/HTML size checks, activity selection and source decoding inside the parser. The configured JSZip reader or an injected archive reader loads bytes; it does not return stored application conversations. Archives with several activities or conversations require explicit selection, while `parseGeminiTakeoutZipArchive` returns a batch of closed Domain results. `gemini-takeout` accepts the same source HTML plus archive inventory for callers that already have them.

`takeoutEvidence.ts` shares the historical prompt/date helpers while decoding native activity facts without export names. ZIP entry paths and filenames are source facts, unlike new export destinations. Exact archive paths or a unique basename can resolve an explicit media reference; ambiguous matches and missing files retain semantic resource records with diagnostics. Uncertain ownership retains an unbound resource instead of fabricating a message relationship. File handles travel beside Domain in `archiveResources`, keyed by asset ID. No native export path is allocated during parsing.

MyActivity records partial activity coverage, not a complete transcript. Native messages use only explicit prompt evidence and source event dates; they do not fabricate request/message/document IDs, assistant dates by adding two seconds, or research-report attachments from a long heading. Authored reports become Content AST. A source-recorded media generation event remains in `DomainMessage.generation` (`mediaKind`, optional `outputCount`) even when output files are absent; this neutral event differs from resource-level generation identity. Unreferenced watermarked filenames and ZIP dates do not establish generation ownership.

The production import/cache/storage path still uses its compatibility API. Offline HTML/ZIP contracts do not replace the pending Tier 2 import/export run.

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
| Existing application/cache records | `compatibility/record/parseConversationRecord.ts` | Keep the compatibility bridge until callers no longer need the persisted shape. |
| OpenAI archive JSON prototype (no production import caller) | `compatibility/openai/openaiParser.ts` | Extend beyond the current toy selected-path parser, then decode raw records directly; preserve author/model facts, creation time, all meaningful roles and source node identities. Specify branching and tool-call/result relationships before projecting a selected path. |
| Gemini RPC/JSPB | `parsers/gemini/rpc/parseConversation.ts` via `gemini-rpc`; compatibility callers remain on `compatibility/gemini/parseDetail.ts` | Direct page-to-Domain implementation and offline parity are covered. Verify live payload compatibility with Tier 2, then migrate pagination/client consumers without changing storage. |
| Gemini Takeout HTML/archive | `parsers/gemini/takeout/parseConversation.ts` and `parsers/gemini/takeout/parseZip.ts`; production import remains on the compatibility API | Native raw HTML/ZIP-to-Domain entry points are implemented. Verify Tier 2 import/export before migrating production callers; keep file handles beside Domain and storage unchanged. |
| Live DOM observations | `content/domScraper.ts` | Distinguish an observed fragment from a complete conversation; preserve authored content and provenance independently of DOM layout. |

The currently linear message list is not a complete branching/tool execution model. Before migrating an input that contains those facts, extend the semantic contract and consumer projection together; do not silently discard non-selected branches or tool messages to fit today's renderer. Unsupported information must remain an explicit migration issue rather than being called complete support.

Each migration needs source-specific fidelity tests, stable identities, closure checks, JSON round trips, diagnostics outside Domain, and unchanged downstream export semantics. Synthetic contracts do not establish provider wire compatibility.

## Storage boundary for this work

No storage implementation, persisted `src/types/conversation.ts` shape, key, serializer, version or migration is changed. Existing fetch/sync/import flows still deliver their historical records to storage. The unified parser runs at the current Domain-facing boundary. Choosing Domain as the future durable semantic model does not authorize writing it into today's storage.

Storage adoption will be handled separately with an explicit versioned compatibility design and upgrade tests. Raw parser migrations must not opportunistically change existing storage callers or reinterpret old persisted records.

## Physical ownership and unfinished parsers

Source parsers and the common parsing contracts live in `src/core/parsers/`; Content AST lives under Domain. Document AST, composition and rendering have separate directories. RPC media filenames and persisted detail projection now live under `compatibility/gemini/`, independently of the raw wire decoder. Pure ZIP validation accepts an optional error translator; the existing UI supplies it from `compatibility/archive/` without making native parsers load storage through the language module. MiTeX's notation compatibility lives in a neutral utility, so renderers do not load the Gemini parser registry.

Gemini RPC and Takeout have native raw-to-Domain entry points and offline contracts, but production client/pagination/import migration and live Tier 2 verification remain pending. OpenAI still has a selected-path archive prototype returning the legacy Conversation shape; it has no native Domain dispatch format or production import caller. Live DOM observations also still enter through existing application records. Neither the directory reorganization nor the record bridge completes those migrations.

Storage files, persisted Conversation types, keys, serialization and migration behavior are not modified. The existing storage layer continues to receive the same compatibility outputs.
