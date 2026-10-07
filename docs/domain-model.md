# Domain contract after C6

C6 closes the Domain model. The composer consumes this contract directly; it must not add provider parsing, resource aliases, export destinations, or presentation fields to Domain.

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

`DomainAsset.kind` describes image, file, audio, video or other resources. Display names, media types, byte lengths, dimensions, failure information and generation metadata are semantic metadata. Document metadata (document ID, creation time, chip URL, sections, links, candidates, extracted Markdown and fabrication flag) stays on the resource. Original inline byte buffers may become detached base64 input facts before Domain. Bytes acquired during export stay only in PreparedResources; they never pass through Domain.

`source.uri` is the original source/acquisition URI. `source.path` does not exist. Export destinations and legacy `localName` are independent preparation hints and never semantic identity evidence. Domain contains no export filenames, storage handles, availability/layout state or per-provider resource aliases. Legacy fields such as `localName` and `subDir` are not part of the public model.

## Consumer boundary

`assertDomainClosure` rejects empty provider identity, repeated asset IDs, repeated attachment relationships and dangling body/reasoning/attachment references. Domain is JSON-portable and exports do not mutate it. Consumers do not parse text nodes as Markdown or HTML.

`composeDomainDocument` consumes the closed graph directly and places explicit attachments not already referenced in content/reasoning. It binds message-local citations, organizes disclosures and sources, and returns one format-neutral Document AST. No Canonical bundle or conversation compatibility adapter exists between Domain and Document AST.

Resource/acquisition hints travel beside Domain, keyed by Domain asset IDs. HTML/Markdown preparation binds IDs to archive destinations. PDF preparation acquires only rendered images into PreparedResources and then validates/mounts their bytes; acquisition outcomes cannot alter Domain or Document AST.

Acceptance is covered by `tests/domain_closure.test.ts`, resource cleanup/generated-media tests, type-level boundary checks and the existing export suites, including AST/HTML/Markdown/Typst corpus parity and JSON round trips.
