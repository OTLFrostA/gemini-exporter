# Storage v2

Consumers outside L3a use only these three public entrypoints:

- `storageService.ts`: the frozen 26-function passive persistence API from the
  [Storage design](https://app.notion.com/p/3fb5d4d759e1816dbc65c1cd23854e00).
- `batchStorageService.ts`: atomic multi-item snapshot/batch persistence for L2
  admission/reads and Application export finalization.
- `vaultStorageService.ts`: passive session, outbox, receipt, keyring and folder
  handle persistence for the separate vault IndexedDB.

Concrete store modules are internal implementations, not consumer entrypoints.

The conversation IndexedDB (`gemini_exporter_v2`, version 3) holds six stores and only the
unique `accounts.providerIdentity` index. The frozen public surface has 26 functions,
including the narrowly scoped atomic Account admission port for L2. Clearing scan
records atomically deletes Index, Detail, Coverage and ExportRecord for the selected account.
Export-history cleanup deletes only ExportRecords; both actions retain Account
and directory handles. Raw partial Settings use one
Chrome Storage key, and Patch uses an extension-origin Web Lock. Content scripts can
read that key, so Settings never hold credentials: reads hide and patches erase the
retired `cloudSyncAccessCode`; the Vault access code lives only in the vault session. Writes resolve after physical transaction completion;
missing values return null/empty collections and IO errors reject. No memory
fallback, resource bytes or persistent task state is stored in the conversation DB.

The separate vault IndexedDB (`gemini_exporter_cloud_v2`) stores the vault session,
outbox, sync receipts, non-extractable derived key handles and local vault folder
handle. It does not store GEK1 recovery text.

The v1-to-v2 schema upgrade revokes historical, unverified Gemini Detail
completeness without deleting content or invalidating existing ExportRecords. It
processes one account and one Detail cursor at a time, waiting for each update
before continuing, and never loads an account's bodies with `getAll()`. An aborted
upgrade rolls back all writes and evicts the failed pooled connection so the next
storage read can retry.

The v2-to-v3 upgrade removes historical source timestamps outside the JavaScript Date
range while retaining valid metadata, bodies and export receipts.

L2 owns identity, Index merging, Detail selection and Coverage admission.
Application owns defaults, Skip, export records and user record cleanup. Runtime
owns extension-origin execution and permissions. The independent Migration module
owns its completion marker; normal Storage never reads or writes upgrade state.

`python3 tests/run_tests.py --filter storage_v2` runs the storage contract suite.
The complete `npm test` additionally covers Application cleanup retention,
cross-context Registry behavior and real browser storage/directory-handle export.
See [Domain type boundaries](../../docs/domain-type-boundaries.md) for
persistence validation and [module-unit isolation](../../docs/v2-unit-isolation.md)
for the distinction between isolated unit tests and integration coverage.
