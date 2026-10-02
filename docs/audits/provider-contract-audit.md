# Provider contract audit (Wave 1 / W1-04)

Baseline: main `25400d9` (2026-10-02). This is an audit and Wave 2 proposal;
production contracts, parser behavior, storage and title arbitration are unchanged.
Gemini is the only production adapter. Preserve the planned provider seam per
`CURRENT_ARCHITECTURE.md`; Python test drivers are a separate abstraction.

## Current contract and dependency graph

`src/core/provider/aiProvider.ts` declares `AIProvider` identity/URL matching,
readiness, aggregate listing, detail acquisition and optional asset acquisition.
Items guarantee id/title, optional URL/update time; details guarantee id/title/
`ChatMessage[]`/optional URL. Both allow arbitrary `any` extensions. Pages expose
items, total, hasMore, nextCursor, stoppedEarly and untyped diagnostics. Readiness
is already explicitly typed (ready/accountSlot/accountName/error).

`providerResolver.ts` imports the self-registering Gemini adapter and selects by
current URL, then default. `providerRegistry.ts` stores `AIProvider` and retains
registration/default/URL routing, including host-pattern fallback for untyped
implementations lacking matchesUrl. Neither file contains a typing escape.
`index.ts` reexports contracts/registry/Gemini; it does not export the resolver.

Actual acquisition graph:

```
Gemini parser -> pagination -> GeminiAPIClient -> GeminiProvider
  -> resolveProvider -> syncEngine -> merge/storage/reconciliation
                     -> liveSaveCoordinator -> assets/formatter/disk
                     -> messageRouter(getConversationDetail response)
                          -> tabService -> export/batchWorker -> exportOrchestrator
                               -> parseDrift / canonical Gemini normalizers
```

Export modules do not import provider types or call AIProvider directly. Their
runtime detail payload nevertheless travels through messageRouter. AssetPipeline
`fetchAssetDelegate`/`fetchAsset` take a request object and return an asset result;
these are NOT `AIProvider.fetchAsset(url): Blob | ArrayBuffer`.

## Consumer matrix

Paths below are repository-relative. N = provider-neutral semantic concept;
G = Gemini-specific representation or policy. A neutral concept does not make
its current wire representation portable.

| Field/method | Producer | Actual reader/use | Boundary |
|---|---|---|---|
| id/name/hostPatterns/matchesUrl | GeminiProvider | ProviderRegistry register/findByUrl; resolver | N; current host values G |
| checkReadiness(context.accountSlot) | credentialManager.resolveCred | No production readiness caller | N readiness; u0/credential token semantics G |
| accountName | Not emitted by GeminiProvider | No production reader through readiness | Declared seam; do not invent requirement |
| listConversations options | syncEngine.tryBatchExecuteFull | adapter passes unchanged to client/pagination | maxPages/callbacks/incremental/signal N; targetSid G |
| forceFull | syncEngine | passed through, not read in core API pagination | Content watermark/reconciliation policy; not a new provider option requirement |
| onPageBatch(batch,{page,hasMore}) and stop decision | pagination | syncEngine.ingestListBatch; page-one snapshot/watermark stop | N control plane, currently parser item type |
| onProgress page/total/hasMore/stoppedEarly | pagination | syncEngine badge and scanProgress message | N |
| items AND conversations | adapter aliases pagination.conversations | syncEngine reads conversations, never items | N list; duplicate name is transitional compatibility |
| id/title/url | parseList/parseDetail + adapter | sync ingestion, detail title persistence, live-save; export | N; c_ normalization/Gemini URL fallback G |
| updatedAt/createdAt/timestamp/chatTime | parser/pagination | syncEngine.scheduleActiveChatDetailFetch and merge; live-save time fallback | N time; multiple legacy aliases need explicit mapping, preserve null |
| titleSource/titles | parser | sync merge/titleUtils; messageRouter.persistDetailTitle; live-save formatter; BatchWorker.resolveChat | N provenance concept; rpc/dom/sniff/takeout tier representation G/application-specific |
| messageCount | list parser/detail pagination | sync active-detail metadata and merge | N optional metadata |
| total/stoppedEarly/hasMore/nextCursor | pagination + adapter | total/progress and exhaustive guard; hasMore/cursor public tests | N; adapter sets hasMore=!!stoppedEarly and nextCursor=null (not a resumable page API) |
| exhaustive/completionReason | pagination spread | syncEngine -> isPaginationExhaustive | N completeness; reasons hit_google_limit/unchanged_boundary require mapping |
| hitGoogleLimit, diagnostics.hitGoogleLimit | pagination | exhaustive guard, syncEngine Takeout prompt/scanProgress | G; neutral completeness may encode incomplete, G UI still needs cause |
| diagnostics | pagination.diagLog | syncEngine persists via setLastSyncDiagnostics and returns scan result; messageRouter forwards; ui/controllers/syncController reads hitGoogleLimit/stopReason for quota UI | G diagnostic payload; storage pass-through is not proof all keys are neutral |
| messages role/content/timestamp | detail parser/pagination | router success gate; live-save time/images; canonical normalizeMessage | N core message data; model role mapping must stay stable |
| attachments/images/documents/generation | parser attachment extraction | liveSaveCoordinator.processAndSaveImages, BatchWorker media supplementation, normalizeAssets | N asset concept; Google media URLs/request identities/report metadata G |
| thoughts/thinking/citations/sources/structuredContent/groundingCitationMarkers | parser | canonical/gemini normalizeMessage/normalizeCitations/structuredAdapter | G input representation; normalize before promising neutral content |
| _raw/_debug | parser | messageRouter empty-detail evidence; BatchWorker.formatDebugInfo/deletion classification | G evidence; never put wire evidence in canonical document |
| schemaDrift/turnsRejected | parser/pagination | export/parseDrift.collectParseDrift (warnings/partial export) | G parser evidence, preserve through adapter |
| truncated/isTruncated/truncateReason/nextPageToken/attachmentCount | parser/pagination spread | pagination consumes cursor; export payload forwarded; adapter tests cover preservation | Completion/count concepts N; cursor/reason representation G; no direct provider consumer for cursor |
| href/sidebarIndex/lastSeen/source/accountSlot | content/merge enrichment | sync sorting/storage | Not provider output obligations; account identity representation G |
| fetchAsset? | No Gemini implementation | No production AIProvider caller | Preserve optional seam; do not equate with export asset delegates |

## Unsafe typing inventory

Exact symbols are stable search anchors; line numbers may move. Scope is the
provider boundary and its first consumers, with downstream escapes classified
separately rather than treating every export `any` as a provider requirement.

| File / symbol | Escape or weak field | Actual dependency |
|---|---|---|
| `src/core/provider/aiProvider.ts`: ProviderConversationItem, ProviderConversationDetail | two `[key: string]: any` | hides the time/provenance/evidence fields in matrix |
| same: ProviderPageResult.diagnostics | `any` | diagnostics persistence and hitGoogleLimit guard |
| same: AIProvider.checkReadiness/listConversations/fetchConversationDetail/fetchAsset | four `context/options?: any` | readiness slot, pagination options/callbacks, targetSid/slot; asset has no current caller |
| `src/core/provider/gemini/geminiProvider.ts`: checkReadiness/listConversations/fetchConversationDetail | three parameter `any`; readiness `catch(e:any)` | credential slot; unchanged options forwarding; e.message |
| same: listConversations/fetchConversationDetail | object spreads preserve undeclared fields | conversations/completeness flags and detail evidence survive runtime but disappear statically |
| `src/types/conversation.ts`: ChatMessage | citations/documents `any[]`; sources `unknown[]`, structuredContent `unknown` | canonical Gemini normalizers; live-save image path |
| same: TitleSources/Attachment/Conversation | string index for title map; open type/source strings; number-or-string time aliases | current provenance/merge compatibility; not all are `any` |
| `src/core/api/client/pagination.ts`: PaginationOptions/Result/diagLog | index `any`, diagnostics `any`, diagLog `any` | adapter forwards page result; sync completeness reads nested limit flag |
| same: GeminiClientPaginationModule/getAllConversations/getConversationDetail | client `any`; retryErr `any`; timestamp filter and attachment-count reducer `any` | upstream parser/client trust boundary; W1-03 audit covers wire internals |
| `src/core/api/geminiClient.ts`: GeminiAPIClient/getAllConversations | class index `any`; onProgress/opts `any` | facade widens typed pagination options before adapter |
| `src/content/syncEngine.ts`: tryBatchExecuteFull | `Promise<any>`, page1Batch `any[]`, **`const all: any = await provider.listConversations(...)`**, callback batch `any[]`/prog `any` | undeclared conversations/hitGoogleLimit/exhaustive/completionReason + broad diagnostics |
| same: scheduleActiveChatDetailFetch/upsertConversations/ingestListBatch | existing.find callback `any`; incoming/existing `any[]`, Map<string,any>, timestamp map/filter `any`, queue Promise<any> | provider and DOM/sniff records mixed in merge/storage; cannot type as only provider items |
| same: touchActiveConversation/sidebar ingestion/account metadata | item `any`, sidebar items `any[]`, slotUpdate Record<string,any> | content/DOM/profile bookkeeping, not neutral provider fields |
| `src/content/contentContext.ts`: ActiveClientContract | optional methods `(...args:any[])=>Promise<any>` and index `any` | permits provider assignment although legacy abort/getAll/getDetail methods differ |
| `src/content/liveSaveCoordinator.ts`: resolveConversationDetail | Promise<any>, message timestamp map/filter `any`, scraper doc cast `as any` | joins provider detail, injected legacy client and DOM fallback |
| same: processAndSaveImages/writeConversationToDisk | chat/writer/dirHandle/target `any`, buffer `any`, collectedAssets `any[]` | asset pipeline downstream; reads undeclared Attachment.originalUrl/alt |
| same: formatter titleProvenance/titles | `(chat as any)` accesses | title provenance lost by broad detail return |
| same: save queue/runtime bridge helpers | Promise<any>, runtime response Promise<any>, catch(err:any), badge/Buffer/binary/buffer/base64 `as any` | host APIs/DI/bytes; separate cleanup, not provider fields |
| `src/content/messageRouter.ts`: MessageRouterDeps/dispatchMessage/persistDetailTitle | storage/utils/message/response/chatObj/current `any`; msgs `any[]`; window `as any`; scan res/debug `any` | joins provider, scraper, storage, runtime envelope and deletion evidence |
| `src/core/engine/export/batchWorker.ts`: FetchChatDetailResult/ResolveChatResult/resolveChat/formatDebugInfo | chat/data/results/rawResponse `any`, result index `any`; callback/document/debug map `any` | indirect runtime export payload, Takeout/stored fallbacks and diagnostic pruning |
| `src/core/engine/assetPipeline.ts`: AssetPipelineOptions; `src/core/export/pdf/{prepareItem,pdfExporter}.ts`: asset options | `(params:any)=>Promise<any>` | separate asset transport contract, not AIProvider.fetchAsset |

Searches of `src/core/provider/` and the three direct content consumers found no
`as unknown as`, `<any>`, `@ts-ignore` or `@ts-expect-error`. The sync escape is an
explicit variable annotation, **not an `as any` assertion**. `aiProvider.ts`
reexports Conversation/ChatMessage/Attachment/TitleSources, but no external
production import uses these reexports; importing ChatMessage internally still
couples the detail contract to Gemini pipeline fields.

## Smallest Wave 2 proposal (not implemented)

Keep existing lifecycle/method names and registry. First type the observed list
control plane and core metadata; do not promise arbitrary extensions. Illustrative
neutral shape (type names here are proposals):

```ts
interface ProviderItem {
  id: string;
  title: string;
  url?: string;
  createdAt?: number | null;
  updatedAt?: number | null;
  messageCount?: number;
}
interface ProviderMessage {
  role: 'user' | 'model' | 'assistant' | 'system';
  content: string;
  timestamp?: number | null;
}
interface ProviderDetail extends ProviderItem {
  messages: ProviderMessage[];
}
interface ProviderPage<T> {
  items: T[];
  total?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  stoppedEarly?: boolean;
  exhaustive: boolean;
}
interface ProviderListOptions {
  maxPages?: number;
  incremental?: boolean;
  signal?: AbortSignal | null;
  onProgress?: (p: {
    page: number; total: number; hasMore: boolean; stoppedEarly?: boolean;
  }) => void;
  onPageBatch?: (items: ProviderItem[], p: {page: number; hasMore: boolean}) =>
    Promise<{shouldStop?: boolean; reason?: string} | void>;
}
```

This is a minimum neutral core, **not a drop-in replacement for today's return**.
Retain typed Gemini detail/list companion contracts at the adapter/application
boundary for current consumers: titleSource/titles (reuse current title input
types), timestamp/chatTime aliases, ChatMessage assets/content, parser evidence,
completionReason, hitGoogleLimit and an explicit pagination diagnostic record.
Use typed adapter-to-content mapping functions rather than an untyped extension
bag. Do not pass a base ProviderDetail to the Gemini formatter and silently drop
multimodal fields. Keep current ChatMessage for that Gemini companion until
documents/citations/structured input have a typed normalization boundary.

Readiness can keep its current explicit result and type its observed context
`{accountSlot?: string}`. Detail's targetSid/slot aliases belong in typed Gemini
options and the existing content acquisition path, not a new cross-provider
session claim. Do not change credential/account isolation. Optional fetchAsset
stays scaffold; no real caller justifies selecting its options today.

Do not derive exhaustive from `!hasMore`: current legacy helper accepts absence
of completeness flags, whereas a future contract should explicitly declare
completeness. Adapter mapping must preserve all existing stop reasons and nested
Google-limit evidence before reconciliation can use a neutral guard.

## Migration order and exact blockers

1. Type parser/pagination outputs and diagLog first (coordinate W1-03 boundary
   work); freeze natural exhaustion/early stop/error/abort/limit behavior.
2. Add explicit provider core/options and typed Gemini companion projections.
   Map existing nullable times and title provenance without altering ranking.
3. Adapt GeminiProvider; keep runtime legacy fields during migration. Contract
   tests must verify callbacks/targetSid precedence and evidence preservation.
4. Migrate syncEngine to items + explicit completeness; isolate Google Takeout
   UI policy/diagnostics. Replace ActiveClientContract's permissive assignment
   only after defining how cancellation reaches provider/client/global mirror.
5. Migrate liveSaveCoordinator and messageRouter together with their injected
   client/DOM fallback contracts, then runtime detail envelope and export
   BatchWorker/parseDrift/canonical input. Remove legacy aliases only after all
   readers move; storage schema stays unchanged.
6. Expand zero-any enforcement only after each production file is clean.

Wave 2 is blocked from a safe wholesale interface replacement by four concrete
couplings: sync consumes undeclared list/control fields; content time/provenance
readers need a typed mapping; runtime detail transport preserves multimodal and
parser evidence without a typed envelope; cancellation currently works through
global abort state rather than an implemented AIProvider.abort. These are code
migration prerequisites, not missing future-provider requirements.

## Compatibility risks and validation

Wrong completeness mapping can mass-delete valid older records. Dropping
titleSource/titles changes title authority. Coercing missing times to zero/current
time affects recency and sorting. Reducing messages to text loses media, citations,
Deep Research and drift warnings. Changing resolver import side effects/default
fallback breaks no-location tests and content bootstrapping. Replacing targetSid
with a generic session without preserving account slots risks cross-account reads.

Existing provider_abstraction/provider_neutral/provider_degrade suites cover
registry, URL/default resolution, tab routing and adapter basic shapes. Two narrow
characterization tests added to provider_neutral cover list callback forwarding/
completeness aliases and detail option precedence/evidence identity. No production
files changed. Required checks: provider suites, type-check, test:changed, full
npm test and pool:status (20/20). Live Tier 2/visual Tier 3 are not triggered by
this docs/tests-only change.
