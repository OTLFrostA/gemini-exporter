# L2 v2 Domain model

The current implementation follows the Notion L2 module and frozen AccountRegistry,
ConversationIndex, ConversationDetail and Resources specifications. The priority
is one owner per business rule, without historical compatibility or migration.

## Facts

| Fact | Schema | Owner |
| --- | --- | --- |
| Account | id UUID, providerId, providerAccountId, email?, displayName? | accountRegistry.ts / accountAdmission.ts |
| ConversationKey | accountId UUID, opaque conversationId | conversationKey.ts |
| Index | key, paired title?/titleSource?, createdAt?, updatedAt? | conversationIndex.ts / titleAuthority.ts |
| Detail | key, messages, assets, quality.status, savedAt? | conversationDetail.ts |
| StreamCoverage | range: {head,tail} or null | streamCoverage.ts / coverageAdmission.ts |

Provider identity comes from Account. Optional facts are omitted; no null variants
are added to Account/Index/Detail. Source timestamps are finite epoch milliseconds.
Index may exist without Detail. DomainConversation is a read composition, not an
additional fact owner. Assets are embedded in Detail, never an independent manager.

## Rules and interfaces

`getOrCreateAccount` matches the exact L1-normalized provider identity atomically.
Display metadata does not participate in matching. Each provider can have a normal
UUID-backed default account; it never becomes or merges into an identified account.

`ingestIndexes` validates Registry ownership and merges partial Index facts. Titles
use user > provider > derived, latest admission at equal priority; missing fields
preserve facts. Creation time takes the earliest source time, activity the latest.

`ingestConversation` is the existing normalized detail admission adapter. It uses
`selectConversationDetail` through `snapshotAdmission` and merges Index separately.
A new complete snapshot can replace a longer body and its entire asset graph.
Partial/unknown cannot replace an existing complete body; two incomplete snapshots
replace by admission order. Comparable older source versions never roll back.

`runtimeValidation` and `closure` own the frozen Content AST, message/citation/asset
shape and internal reference checks. Message generation activities and raw parser
evidence are not persistent Domain fields. Asset generation identity remains source
evidence for actual resources. Resource bytes and temporary download hints stay in
separate acquisition/storage context. Rejected snapshots cannot change the retained body or asset graph. Independently
acquired bytes may fill its existing, reliably matched resource bindings.

`getCoverage(accountId, streamId)` reads committed range-only coverage.
`hasTrustedBoundary(accountId, frozenBaseline, scanHead)` owns historical overlap
proof. New boundaries require a valid head-to-terminal cursor chain after Index
commits; partial scans do not establish them. No persisted scan flags, revision,
cursors, ordering-invalidated state or aggregate completion fields are retained.

## Neighbors and remaining scope

L1 extracts/normalizes source facts and calls Domain admission. Its pure Parser
returns data; its Client/Sniffer/Import performs submission. The active list adapter
submits each page before returning control evidence to Sync. Application owns
ScanRun and stops/cancels; ordinary Scan All requests Recent only. Other L1 and
Application restructuring is outside this L2 change.

Storage owns locks, physical keys, atomic Account creation and snapshot commits.
It never chooses titles, bodies or coverage. Its physical envelope can contain
bytes/bindings and tokens independently of the Domain schema. Cross-medium ACID
is not promised; required commit failures propagate.

AST Composer and JSON receive the admitted Account + matching Index/Detail.
Domain does not own formatting, export records or delivery. Full L1/Export/PDF v2
work is deferred. Remote absence/deletion never erases local archives.

See [Domain admission and storage](domain-storage.md) for the operational map.
