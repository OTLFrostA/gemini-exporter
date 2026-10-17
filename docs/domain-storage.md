# Domain storage and admission

L1 interprets sources and submits normalized facts. L2 decides which facts to keep.
Storage owns reads, writes and serialization. Application reads accepted facts;
it does not forward Parser Results for admission.

## Admission boundary

`domain/ingestion.ts` exposes the frozen interfaces:

```ts
ingestIndexes(accountId, [{ conversationId, fields }], page?): Promise<void>
ingestDetail(accountId, conversationId, detail, indexFields?): Promise<void>
```

L2 resolves the Registry account and constructs ConversationKey. Index uses
`mergeConversationIndex`; Detail uses `selectConversationDetail`. Gemini and ChatGPT
acquisition, passive observations, DOM acquisition and Takeout all submit here.
Execution parameters, Parser Results, resource bytes and storage records are not
admission arguments. There is no second snapshot-selection callback in Storage.

Index merges and Detail selection run under Storage's conversation lock. Index is
committed first. If Detail persistence subsequently fails, Index remains committed
and the error propagates. Index failure prevents the Detail write. No distributed
transaction across Chrome Storage and IndexedDB is promised. Page Coverage is
admitted only after its Index commit; it retains its existing range/cursor rules.

## Business rules

Account uses a Registry UUID and exact L1-normalized provider identity. Display
metadata does not participate in matching. Each provider may have an ordinary
UUID-backed default account; it never implicitly merges into an identified account.

Index title authority remains `user > provider > derived`, with the later admission
winning at equal authority. Missing facts preserve existing values. Creation uses
the earliest source time and activity the latest. Unknown facts stay absent.

Detail selection retains a whole snapshot, including its asset graph. Complete
bodies are protected against partial/unknown captures. Comparable older source
versions cannot roll back a body. Otherwise the later capture wins, including a
shorter complete body. There is no body stitching or message-count preference.
Index-only admission cannot change Detail or its `savedAt` source version.

## Physical ownership and read composition

`storage/conversationCatalogStore.ts` remains the sole Index authority in
UUID-partitioned Chrome Storage. `storage/domain/domainStore.ts` persists only
Detail: key, quality, messages, assets and optional savedAt. It contains no Index,
revision, acquisition hints or resource bytes. Storage does not merge/select facts.

The v2 IndexedDB namespace is `gemini_exporter_v2`, physical version 1. Account and
Detail use their stores. The other stores reserved by the frozen physical layout
are placeholders in this change: Index/Coverage/export records/directory handles
retain their current implementations. This L2 change does not implement the full
Storage module migration, and supplies no historical-data compatibility path.

`storage/conversationRepository.ts` and `storage/domain/nativePersistence.ts`
combine the canonical Index with independently loaded Detail for reading.
DomainConversation is this composition, never another persisted authority. Missing
Index does not promote an orphaned Detail into the catalog.

## Validation boundaries

`domain/runtimeValidation.ts` owns complete Schema and reference-closure validation.
Parser finalization validates source output. Admission reuses the same validated
body in memory; otherwise it validates incoming Detail facts. A module-local
WeakSet records this evidence without adding a serialized Schema field.

IPC receivers validate raw input again. Detail restored from IndexedDB also passes
complete validation and identity checks. Structured-clone transport/persistence
already detaches these values, so validation adds no JSON serialization/clone.
Physical Detail writes check only persistence identity constraints. Internal
composition does not repeat deep validation of trusted bodies.

## Resources and cleanup

Assets remain semantic facts embedded in Detail. `resourceContext.ts` separately
holds temporary acquisition hints and bytes for the current background execution;
it does not create a resource-bytes table. Content scripts and extension pages use
the background broker to share this context. Inline data is decoded outside Domain.

Acquired bytes bind only to reliably matched assets in the selected Detail. A
rejected partial body may fill missing bytes for a retained asset, but cannot
replace that body or graph. Export can consume these bytes during the execution.
Background termination clears this temporary context; re-export then depends on
available source locators or reacquisition.

Cloud deletion and missing list rows never erase local facts. Explicit local
cleanup removes the selected account's Index, Detail, temporary resources and
related execution records, preserving other accounts.

## Pending cross-module task: Acquisition / Export resource lifecycle

**Open; not implemented by this L2 change.** The current
`storage/domain/resourceContext.ts` and the resource commands in
`background/domainStorageHandler.ts` are transitional wiring, not the frozen
Storage design. Storage must not own acquisition state. The runtime-global Map
has no task-completion cleanup; Takeout eagerly fills it with decoded bytes, so
large imports can retain substantial memory until explicit deletion or background
termination. This PR does not resolve that memory risk.

The follow-up belongs to Acquisition / Export, with these concrete completion
conditions:

- Move bytes, temporary locators and resource bindings into acquisition/export job
  context, including the broker operations; remove the global resource state from
  Storage without changing the Domain Schema or adding another admission path.
- Pass that context to consumers for the job's lifetime. Takeout should resolve
  bytes from its archive on demand rather than keep all decoded media globally.
- Release the context on success, cancellation and failure through the same job
  cleanup path. Closing one job must preserve resources still owned by another.
- Verify bounded retained memory over a large import and repeated jobs, cleanup on
  cancellation/failure, concurrent job isolation and successful asset export.

L2 continues to admit only semantic Asset facts. Its Index/Detail rules do not
own resource acquisition or cleanup. Export lifecycle work is intentionally
separate; the current temporary context cannot be considered its final design.

## Verification

Tier 1 tests cover shared admission, independent Index/Detail writes and failure
propagation, snapshot protection/replacement, raw-input validation, and resource
separation. Browser tests inspect physical IndexedDB records. Live Tier 2 is outside
this round's scope. Failures already present on the reconstruction branch are
reported separately from L2 verification.
