# Domain storage and admission

The Domain contract describes accepted local facts. Source interpretation belongs to
L1 Provider/Parser, pure admission rules belong to L2 Domain, and transactions belong
to Storage. Application consumers read the accepted local result.

## Identity and contracts

- `domain/accountRegistry.ts`: Account is `{id, providerId, providerAccountId,
  email?, displayName?}`. The local ID is a UUID; matching uses the exact provider
  and provider account ID. L1 normalizes provider identity. Each provider can have
  an ordinary `default` account with its own UUID; it is never implicitly promoted
  or merged into an identified account.
- `domain/conversationKey.ts`: `{accountId, conversationId}` identifies both Index
  and Detail. Provider ownership is resolved through Account.
- `domain/conversationIndex.ts`: Index contains only `key`, optional `title` with
  `titleSource`, `createdAt`, and `updatedAt`. Title authority is
  `user > provider > derived`; the latest admission wins at equal authority.
  Missing facts preserve existing values. Creation uses the earliest source time,
  activity the latest source time. Unknown titles/times remain absent.
- `domain/conversationDetail.ts`: Detail contains `key`, `messages`, `assets`,
  `quality: {status}`, and optional `savedAt`. The latter is the source snapshot
  version, never a local write clock or a message count.
- `domain/indexCoverage.ts`, `streamCoverage.ts`, `scanCoverage.ts`: trusted list
  coverage advances only after all indexes on the observed page commit.

Domain excludes pagination cursors, availability, import markers, parser diagnostics,
resource bytes, acquisition failures and export destinations. Temporary `data:` and
`blob:` resource locations stay outside Domain. Assets retain semantic resource
metadata and source locators; content and reasoning refer to their asset IDs.
Generated-media identity fields are optional when the source cannot establish them.

## Snapshot selection

`selectConversationDetail` selects one entire snapshot, including its asset graph.
A complete snapshot is protected from partial/unknown input. Comparable older
source versions are rejected. Otherwise a later admission replaces the snapshot,
including a shorter complete body or a shorter incomplete body. There is no
partial-body stitching or message-count preference.

Index metadata merges independently, so an Index-only update cannot advance the
selected Detail's `savedAt`. Rejected input cannot attach its acquisition hints or
resource bindings to a retained body.

## Ingestion and persistence

`storage/conversationIngest.ts` is the shared admission entry point. It validates
Account and conversation ownership, saves the selected body, then merges and
commits the Index under the conversation lock. L1 detail acquisition (Gemini and
ChatGPT), content observations/live saves and Takeout imports use this boundary
before Application consumes the result. Failed commits propagate; list coverage
does not advance after an Index failure.

`storage/conversationCatalogStore.ts` owns UUID-partitioned Chrome metadata keys,
strict detached reads and serialized read/merge/write operations.
`storage/domain/domainStore.ts` owns the current IndexedDB snapshot and the separate
resource-byte cache. Current Domain/storage and transport envelopes are version 3;
the physical IndexedDB layout version remains independent. Readers reject obsolete
or malformed contracts without repairing them. This refactor adds no migration or
compatibility path for old identities or old Domain snapshots.

Resources are embedded in Detail; there is no separate Domain Resource manager.
Inline acquisition inputs are decoded into the existing byte cache. Replacements
remove bindings for assets no longer in the selected graph. Unchanged resource
identity/source can retain cached bytes. Actual bytes never become Domain fields.

`storage/conversationRepository.ts` combines the canonical catalog Index with the
selected body for a read-only consumer. It does not fetch providers or repair data.
Composer receives Domain plus Account and does not synthesize provider URLs.
Export workers re-read the admitted result; existing format pipelines only adapt
to the new contracts. Full unified Export/PDF lifecycle work is a separate module.

## Availability and explicit cleanup

`storage/conversationAvailability.ts` stores account-scoped execution observations
separately from Index/Detail. A confirmed cloud deletion can restrict acquisition,
but deletion, list absence and network failure never erase the local archive.
Only explicit local cleanup removes Index, Detail, resource bytes, availability and
export records. A durable deletion intent allows failed cleanup to be retried
without relying on an already-removed list row. Other accounts remain isolated.

## Verification

Admission tests exercise complete/partial selection, source-version ordering,
whole asset-graph replacement, byte separation, ownership isolation and commit
failure propagation. Existing parser, storage, export and browser audits remain
integration gates. This round validates Tier 1 only, as requested; live Tier 2
validation is outside its acceptance scope. Pending runs are not passing evidence.
