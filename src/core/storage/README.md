# Storage v2

The public entry point is `storageService.ts`. It exports the frozen passive
persistence functions from the [Storage design](https://app.notion.com/p/3fb5d4d759e1816dbc65c1cd23854e00)
and [physical layout](https://app.notion.com/p/3fc5d4d759e1813297a3e34a874c60e4).

- One IndexedDB (`gemini_exporter_v2`, version 1), six stores; no legacy reads,
  migration, memory fallback, resource bytes, or persistent task state.
- Only raw `Partial<GlobalSettings>` uses Chrome Storage, under
  `gemini_exporter_v2_settings`; change notification remains Chrome's native API.
- Writes resolve after the IDB transaction completes or Chrome's set completes.
  Missing records return null; lists return [] or {}. I/O failures reject.
- Indexes and details are replaced exactly as supplied. Ordinary deletion only
  affects its key. `clearStoredAccountData` alone clears the account's four data
  stores in a single transaction, including orphaned details/records/all streams.

## Integration boundary

This is a breaking module replacement. Consumers still importing removed storage
files or the former default `StorageService` object must be updated by their
respective module owners; no compatibility wrappers are provided here.

L2 owns account allocation/profile decisions, index merge, detail selection, and
index-before-coverage sequencing. Application owns settings defaults/effectiveness,
export completion/skip decisions, and explicit account clear orchestration.
Browser Runtime owns extension-origin execution, IPC and directory authorization.
Acquisition/Export owns temporary bytes and hints; the removed resource context
is not relocated into another module by this change.

The new Application files contain only the frozen `ExportRecord`, `ExportFormat`
and `GlobalSettings` declarations needed by these storage signatures. No
Application behavior or consumer adapters are implemented here.

## Scoped Tier 1 verification

```
python3 tests/run_tests.py --filter storage_v2
./node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types chrome,node src/core/storage/*.ts tests/storage_v2.test.ts
```

The contract suite uses Chromium's real IndexedDB and native directory handles;
Chrome Settings and its change notification are mocked. Historical suites coupled
to the removed API remain for their consumers' refactors. No whole-project tests,
Tier 2 or Tier 3 are run for this module-only change.
