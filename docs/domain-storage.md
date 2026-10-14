# Versioned Domain storage

The semantic persistence pipeline is now:

```text
old chrome/IndexedDB record → legacy-storage parser → Domain → v2 repository
new raw source → native parser → TrustedDomain → v2 repository
v2 repository → shared snapshot restoration → TrustedDomain → Document AST → renderer
```

`gemini_schema_version = 2` marks the application migration. The repository lives
under the extension origin in `gemini_exporter_domain` (IndexedDB version 2).
Content scripts use the background message broker; they do not create a second
Domain repository under the Gemini web origin. Old web-origin detail databases
are transferred separately when that origin is next opened, even if extension
startup already completed v2. The original databases are retained.

## Stored contract

`src/core/storage/domain/contracts.ts` defines the envelope. Its storage version
is 2 and its Domain contract version is 1; those are independent of IndexedDB's
physical database version. Identity is the tuple `(providerId, accountSlot,
conversationId)`. Only Gemini's historical `c_` alias is normalized; other
providers' IDs remain opaque. Gemini's `default` account transport alias maps to
`u0`; other providers' account identities remain opaque. Account slots retain the application's existing
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
numbers. Domain contract version is now **2**, independently of IndexedDB/storage
version 2. New writes reject all v1 aliases. Only physical records explicitly
marked `domainVersion: 1` pass through the single historical recovery converter.
Recovered snapshots carry version 2; reads do not rewrite originals. An unsafe
conversion throws with a diagnostic while retaining the original record.
Unknown future versions fail closed.

Persisted `DomainStorageRecord` remains an unbranded JSON contract. Every physical record recovery establishes `TrustedDomainStorageRecord` with `restoreDomainSnapshot` (re-exported as `readStorageDomain`). Restoration intentionally retains two Schema passes, before and after JSON serialization, and one Closure pass. This is one trust-restoration operation, not one total tree traversal. Writes perform the same detached-snapshot checks because a type-only brand does not freeze caller objects; reading an existing physical record during a write requires its own restoration.

Trusted internal record adaptation retains envelope/version, identity, acquisition/resource/digest bindings and detached-copy isolation without repeating Domain AST validation. Content scripts use a current-version authenticated Broker reply adapter after the background restores a record. Raw Broker saves still establish trust at the background write snapshot boundary. Communication envelope version 2 rejects stale extension/page code carrying the previous Domain schema; publishers and consumers share the existing envelope-version constant. This protocol version remains outside Domain and does not change IndexedDB/storage versions. Page `postMessage` is never that authenticated channel: origin/source checks plus raw protocol field checks lead to Parser input, not TrustedDomain.

See [the trust audit](domain-trust-audit.md) for authorized entries, remaining assertions, measured Schema/Closure counts, and qualified validation results.

Each conversation has exactly one selected record in `conversations`; no
revision history is retained. The record's `revision` field is only an opaque
token for that current record. An identical capture leaves the current record
unchanged. Shorter snapshots, older timestamps at the same message count, or
reduced coverage (including a larger partial/unknown snapshot replacing a complete one) cannot replace the selected fuller snapshot;
their body is not selected. A stronger title may still be adopted through the shared title authority without replacing that body. Stable resource bytes carry
forward only when asset identity and source URI still match. Online acquired
bytes use a separate `resource_bytes` store keyed by conversation identity,
asset ID and original source URI, and survive restart. The IndexedDB v1 → v2
upgrade deletes the old `revisions` store; current records, byte bindings and
legacy backups are untouched by that upgrade.

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
version stamp. The current record commits in one IDB transaction;
request success alone is insufficient. Retrying does not overwrite a newer native
capture and does not create duplicate records. Host-origin migration has its
own marker and report, stamped only after its transfer completes.

## Application compatibility

Conversation list metadata, export status, account mappings, credentials,
preferences and directory handles retain their existing independent APIs. The
chrome conversation list remains the UI index. It is not the semantic body store.
Fresh native captures from network interception, detail fetching, DOM fallback,
live saving and Takeout import write Domain directly to the new repository.
Takeout import also stores source-bound file bytes before reporting success.

Export fallback reads account-scoped native Domain records; it never decodes the
historical detail cache at runtime. Missing bodies remain retryable failures.
Only old-storage migration interprets historical string records. Standard JSON
serializes native Domain directly, without an application projection.
The old detail API remains for migration and characterization; native writes do
not write a second legacy body. Scoped deletion removes the
selected current record and its acquired bytes while preserving other
accounts. `removed_conversations` markers prevent late migration/retry from
restoring removed bodies; an explicit fresh source capture can restore them.
Confirmed remote deletion also suppresses stale page observations in that tab.
Conversation deletion first records account-scoped intent in
`gemini_pending_deletions_uN`, before removing list metadata. Single deletion
cleans by ID even when the list entry is already absent; reconciliation and clear
also replay pending IDs. An ID is retired only after the Domain current
record/bytes and its `removed_conversations` tombstone commit, legacy detail
deletion commits, and export-record cleanup succeeds. Disk failures propagate
instead of reporting memory fallback as success, so restart/retry can finish a
partial deletion. `removeConversation` still returns whether list metadata
changed; a successful cleanup retry may
therefore return `false`. Reconciliation includes recovered pending IDs in its
`removedIds` result. Original migration backups are retained for recovery.

## Verification

Unit contracts cover strict schema validation, closed graphs, rich content/model
round trips, account/provider isolation, coverage guards, byte durability,
idempotence, scoped deletion and future-version freeze. Browser tests use actual
IndexedDB transactions and reloads, inject a transaction/quota abort, acquire
stored attachments offline, migrate the old web-origin database, and prove a
content-script capture remains readable from the extension after its tab closes.
Full Tier 1 and live Tier 2 remain the release gates for integration changes.

Final integration acceptance: [storage v2 Tier 2 record](audits/domain-storage-v2-tier2.md).
