# Versioned Domain storage

The semantic persistence pipeline is now:

```text
old chrome/IndexedDB record → legacy-storage parser → Domain → v2 repository
new raw source → native parser → Domain → v2 repository
v2 repository → Domain → Document AST → renderer
```

`gemini_schema_version = 2` marks the application migration. The repository lives
under the extension origin in `gemini_exporter_domain` (IndexedDB version 1).
Content scripts use the background message broker; they do not create a second
Domain repository under the Gemini web origin. Old web-origin detail databases
are transferred separately when that origin is next opened, even if extension
startup already completed v2. The original databases are retained.

## Stored contract

`src/core/storage/domain/contracts.ts` defines the envelope. Its storage version
is 2 and its Domain contract version is 1; those are independent of IndexedDB's
physical database version. Identity is the tuple `(providerId, accountSlot,
conversationId)`. Only Gemini's historical `c_` alias is normalized; other
providers' IDs remain opaque. Account slots retain the application's existing
account mapping and are not invented provider account IDs.

The `conversations` object store holds the selected `DomainStorageRecord`:

- A closed `DomainConversationDetail`, preserving structured body/reasoning,
  roles, model names, dates, source facts, citations and resource relationships.
- Storage identity, versions, source/migration origin, revision and save time.
- Separate resource bindings: asset ID, original archive path when known, and
  actual attachment bytes. Acquired bytes never become Domain or AST fields.
- Restricted acquisition context containing original URLs and candidates.

Diagnostics, RPC debug/pagination state, export destinations and ZIP file handles
are excluded. Domain is strictly validated at both write and read boundaries,
including field shapes, content nodes, resource/citation closure and finite
numbers. Unknown future versions fail closed.

The `revisions` store retains nonidentical captured snapshots. An identical
capture does not append another revision. Shorter snapshots, older timestamps
at the same message count, or reduced coverage at the same count cannot replace
the selected fuller snapshot. Such new-source observations remain in history.
Stable resource bytes carry forward only when asset identity and source URI
still match. Online acquired bytes use a separate `resource_bytes` cache keyed by
conversation identity, asset ID and original source URI, and survive restart. Capture retention and compaction can be refined separately; this
upgrade does not discard earlier snapshots to save space.

## Legacy interpretation and recovery

`parseConversation({ format: 'legacy-storage', providerId, data })` accepts old
metadata and an optional detail record. It reuses the characterized historical
record grammar, joins the fuller body with metadata, preserves available model,
reasoning and media evidence, and produces the same closed Domain result as other
parsers. Metadata without an expected stored body reports partial coverage.

Migration first scans and backs up the original list containers and detail rows
in `legacy_imports`, then converts interpretable records. A details record shared
by several account slots has no reliable account identity: it stays recoverable
without being assigned to either account. Orphan details and malformed rows also
remain in the backup/original source and appear in the migration report. They are
not silently repaired into fabricated Domain data. Uninterpretable records are
preserved as explicit migration issues; the v2 stamp means the transfer completed,
not that every historical row was interpretable.

Disk/open/transaction failures abort migration and withhold the application
version stamp. Both current record and revision commit in one IDB transaction;
request success alone is insufficient. Retrying does not overwrite a newer native
capture or multiply already transferred revisions. Host-origin migration has its
own marker and report, stamped only after its transfer completes.

## Application compatibility

Conversation list metadata, export status, account mappings, credentials,
preferences and directory handles retain their existing independent APIs. The
chrome conversation list remains the UI index. It is not the semantic body store.
Fresh native captures from network interception, detail fetching, DOM fallback,
live saving and Takeout import write Domain directly to the new repository.
Takeout import also stores source-bound file bytes before reporting success.

Export fallback reads the account-scoped native record before the historical
detail cache. Runtime compatibility views can still produce old string fields for
JSON/application consumers, but those strings are not the new stored semantic
body. The old detail API remains for historical inputs and characterization;
native writes do not write a second legacy body. Scoped deletion removes both the
selected record, its native revisions and acquired bytes while preserving other
accounts. `removed_conversations` markers prevent late migration/retry from
restoring removed bodies; an explicit fresh source capture can restore them.
Confirmed remote deletion also suppresses stale page observations in that tab.
Original migration backups are retained for recovery.

## Verification

Unit contracts cover strict schema validation, closed graphs, rich content/model
round trips, account/provider isolation, coverage guards, byte durability,
idempotence, scoped deletion and future-version freeze. Browser tests use actual
IndexedDB transactions and reloads, inject a transaction/quota abort, acquire
stored attachments offline, migrate the old web-origin database, and prove a
content-script capture remains readable from the extension after its tab closes.
Full Tier 1 and live Tier 2 remain the release gates for integration changes.
