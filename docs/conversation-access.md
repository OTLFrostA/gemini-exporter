# Conversation access

Application reads of a saved conversation go through a repository bound to an
explicit provider and account. Creating a repository does not read global active
account state, and later UI account switches do not change its scope.

```ts
const repository = StorageService.conversationRepository({
    providerId: 'gemini', accountSlot: 'u0',
});
const index = await repository.getConversationIndex(id);
const conversation = await repository.getConversation(id);
```

The aggregate is `{ index: DomainConversationIndex, detail?: DomainConversationBody }`.
The body contains only `messages`, `assets` and `completeness`. Title, title source,
creation time and URL are read exclusively from `index`; there is no second metadata
copy to arbitrate inside the aggregate. Identity belongs to the aggregate's index.
Message timestamps remain message facts. List messageCount is the largest observed
individual-message count, not a promise that the saved body contains that many messages.

## Absence and failures

- No catalog index: `null`. An orphan body is not silently published or repaired.
- Index but no saved body: an aggregate with no `detail` property.
- Saved empty body: `detail` is present with an empty `messages` array.
- Partial/unknown coverage: preserve `detail.completeness`; do not disguise it as absence.
- Storage, broker and schema errors: reject the promise, rather than returning `null`.

`getConversationIndex` does not read IndexedDB or decode a body. Both methods return
detached values. Provider and account are part of lookup identity; Gemini `c_` IDs
and the released `default` account alias normalize at the storage boundary. The
Chrome catalog backend accepts explicit `uN` slots and rejects unsupported slot
names rather than silently falling back to the first account.

## Saved body evidence and existing exporters

`getStoredConversation(id)` returns `{ conversation, capture? }`. A capture contains
the saved record's `revision`, optional `savedAt` and resource acquisition hints.
These are persistence evidence, not Domain conversation metadata. Index activity
may be newer than `capture.savedAt`; readers never replace the latter with Index
activity or a local clock. A body with no provable version keeps it unknown.

The storage result also identifies `indexOrigin: 'catalog' | 'recovered'`.
`recoverStoredConversation(id)` is an explicit archive recovery operation used by
export. It prefers the catalog, but when only a durable body survives it reconstructs
an ephemeral index from that snapshot's source facts, with unknown cloud availability.
It never publishes that index or promotes cached metadata over an existing index.
Ordinary `getConversation`, `getConversationIndex` and `getStoredConversation` still
report an absent catalog entry as `null`. This preserves export of retained bodies
when catalog/deletion writes failed, without making normal reads repair storage.

`conversationParseResult` is the one compatibility adapter for existing renderers.
It reconstructs the existing parser/storage snapshot shape using metadata only
from the aggregate index and `sourceVersion` only from the actual capture's savedAt.
An absent Index URL/creation time remains absent; stale body fields cannot leak back
through a fallback. `getConversationWithDetail` delegates to the same repository
and adapter and is deprecated for new callers.

The old `DomainConversationDetail` snapshot shape remains the parser/storage wire
contract during upstream migration; this change does not change persisted schemas.
Its historical metadata is not an application read authority. Low-level
`getDomainConversationResult` remains for migration/recovery and storage verification;
production cached export reads use the scoped repository instead. Direct online
and Takeout parser outputs are acquisition observations, not saved-conversation reads.

Cached exports reread the current Index before preparation, even when the caller's
list selection is older. They do not merge saved metadata as fresh evidence or mark
the catalog for writeback. Online/Takeout acquisition observations still pass through
the existing index merge rules; creation time and URL are projected consistently
along with title/source before formatting.

## Writes and consistency

Acquisition persistence publishes the body before its Index under the existing
conversation lock (`saveConversation`). Existing acquisition producers and Takeout
imports retain their explicit catalog publication after raw parsing/resource persistence;
`persistNativeConversation` is the acquisition storage primitive for that path.
Index metadata comes from the incoming observation, independently of the storage
policy choosing which body to retain. A rejected short/partial body therefore cannot
substitute an older selected body's title for a new metadata observation.

Repository aggregate reads participate in the existing browser-origin conversation
lock used by catalog writes/removal. Web-origin and extension-origin contexts do not
share a Web Lock; this is not a global cross-origin transaction.
Each body is a committed IndexedDB record including its own version. Chrome storage
and IndexedDB are still two physical stores: this is not a cross-store ACID snapshot.
A failed catalog publication can leave an orphan body for explicit recovery/retry;
reads never promote it. Low-level body operations remain internal storage/migration
primitives and do not acquire the catalog lock recursively.

Bulk index listing continues to use `getConversations` for the UI/sync inventory;
it does not load all bodies. Resource byte access remains asset-keyed storage access.
