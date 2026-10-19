# Storage v2

`storageService.ts` exports the frozen passive persistence API from the
[Storage design](https://app.notion.com/p/3fb5d4d759e1816dbc65c1cd23854e00).

One IndexedDB (`gemini_exporter_v2`, version 1) holds six stores and only the
unique `accounts.providerIdentity` index. The public surface has exactly 22
functions; user cleanup atomically deletes Coverage + ExportRecord or ExportRecord
alone, while retaining Account, Index and Detail. Raw partial Settings use one
Chrome Storage key, and Patch uses an extension-origin Web Lock. Writes resolve after physical transaction completion;
missing values return null/empty collections and IO errors reject. No memory
fallback, resource bytes or persistent task state is stored here.

L2 owns identity, Index merging, Detail selection and Coverage admission.
Application owns defaults, Skip, export records and user record cleanup. Runtime
owns extension-origin execution and permissions. `migrationMarker.ts` supplies
physical Chrome IO to Migration; it does not interpret upgrade policy.

`python3 tests/run_tests.py --filter storage_v2` runs the storage contract suite.
The complete `npm test` additionally covers Application cleanup retention,
cross-context Registry behavior and real browser storage/directory-handle export.
Retired v1 storage aliases are removed from production and tests; see the
[integration audit](../../../docs/v2-integration-cleanup.md).
