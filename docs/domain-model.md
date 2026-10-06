# Domain contract after C6

C6 closes the Domain model. Document AST work must consume this contract through an adapter; it must not add provider parsing, resource aliases, export destinations, or presentation fields to Domain.

```ts
DomainConversationDetail {
  providerId: string;
  assets: DomainAsset[];
  messages: DomainMessage[];
  // Existing conversation metadata.
}
DomainMessage {
  content: BlockNode[];
  reasoning?: BlockNode[];
  attachmentIds?: string[];
  // Existing role, identity, timestamp, provenance and citations.
}
```

## Producer boundary

Provider/legacy adapters parse body and exposed reasoning before returning Domain. Gemini live and Takeout producers identify themselves as `gemini`; OpenAI imports identify themselves as `openai`. Other producers supply their identity explicitly. Domain export always uses the conversation's `providerId`, including diagnostic provenance. Export options cannot override it.

Adapters reconcile `attachments`, `images`, `documents`, structured-body evidence, generated-media evidence and body/reasoning references across the entire conversation. Deduplication requires source references, document identity, provider tokens or reliable generation identity. A matching filename alone does not prove two resources are the same. Conflicting document/generation identities and unknown image ordinals remain distinct. Identical source-less records can reconcile parallel aliases within one message; they do not establish identity across messages.

## Resource graph

Each semantic resource has one `DomainAsset` record. Every image/file `assetId` in content or reasoning and every `attachmentIds` entry refers to that registry. An explicit attachment relationship preserves source order. A body-only resource does not acquire a second explicit attachment relationship merely because it appears in content. A resource can be referenced by several messages, and the registry preserves the union of known semantic metadata.

Asset IDs are opaque and independent of export numbering. Known source/document/generation evidence yields deterministic IDs. Unidentified or conflicting resources receive separate minted IDs; consumers preserve them rather than reconstructing identity. These IDs survive JSON serialization. Changing message order does not change identities supported by unambiguous source evidence.

`DomainAsset.kind` describes image, file, audio, video or other resources. Display names, media types, byte lengths, dimensions, failure information and generation metadata are semantic metadata. Document metadata (document ID, creation time, chip URL, sections, links, candidates, extracted Markdown and fabrication flag) stays on the resource. Acquisition byte buffers become detached base64 strings before Domain.

`source.uri` is an acquisition reference; `source.path` is an entry in the input archive. Neither is an export destination. Domain contains no export filenames, storage handles, availability/layout state or per-provider resource aliases. Legacy fields such as `localName` and `subDir` are not part of the public model.

## Consumer boundary

`assertDomainClosure` rejects empty provider identity, repeated asset IDs, repeated attachment relationships and dangling body/reasoning/attachment references. Domain is JSON-portable and exports do not mutate it. Consumers do not parse text nodes as Markdown or HTML.

The existing Canonical input adapter resolves registry IDs to the existing export asset input. Inline resources carry their semantic identity separately from their acquisition URI so export cannot infer a different relationship from matching basenames. This preserves the current Canonical schema, Document AST and renderer behavior; their redesign is a later phase. Registry uniqueness is a Domain invariant, while the existing export representation can still create a presentation asset for each message that uses the resource.

Acceptance is covered by `tests/domain_closure.test.ts`, resource cleanup/generated-media tests, type-level boundary checks and the existing export suites, including AST/HTML/Markdown/Typst corpus parity and JSON round trips.
