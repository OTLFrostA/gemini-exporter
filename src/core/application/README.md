# Application

Implementation of the frozen [Application design](https://app.notion.com/p/3fb5d4d759e181169ed3dfed880a093a).

Public entry points are exported from `index.ts`:

- `scanAll(request, { onProgress, signal })`: Recent only, one startup Coverage snapshot, L1 committed-page counters, L2 boundary decision. No Cursor handling, admission, Coverage writes, UI strings or durable scan state.
- `runExport(request, { onProgress, signal })`: one sequential workflow for Markdown/HTML/JSON/PDF. Refresh through L1, reread local Domain, prepare resources once, plan all batch paths once, format, deliver and commit the latest Record. Task-level Provider instances are constructed by L1, not selected in Application. No durable task/session/checkpoint.
- `getSettings`, `updateSettings`, `isLiveSaveEffective`: one GlobalSettings schema; defaults on read, explicit patches on write, no changes to enabledDisk when format/permission prevents Live Save.
- `deleteLocalConversations`, `clearLocalExportRecords`, `clearLocalAccountData`: explicit local cleanup only. Selected deletion leaves Index last and preserves Coverage; account-wide clearing delegates Storage's single transaction.

## Storage and Domain integration

Storage v2 implements the public passive APIs in `storageService.ts`. Its `getDetail` returns a detached, unbranded `DomainConversationDetail`. Application reads through L2's `readConversation(key)`, which validates the persisted Index/Detail schema, closure and requested key before returning trusted Domain to Composer/Format. No Provider response DTO is used as export input.

L2 owns account profile rules, Index/Detail selection and Coverage admission. Its small admission lock serializes read/select/write across extension contexts using Web Locks; Storage owns only physical transactions and unique identity insertion. Runtime must execute these operations at the extension origin.

## Remaining UI / Browser Runtime migration

UI/Runtime callers must replace the removed class-based engine, completion helpers, Live Save writer, session recovery and `syncConversations` contracts:

- Popup: submit the current key, `skipUnchanged: false`, Browser Download.
- Options: submit explicit keys/options; `skipUnchanged` comes from `settings.skipExported`.
- Live Save observers: when `isLiveSaveEffective` is true, submit Markdown + Folder Writer + `skipUnchanged: true`, consuming the same includeAssets preference. No alternate format/write/record pipeline.
- Runtime: run the workflow in the context holding the real network/file/font capability; forward progress/cancel through existing thin IPC. Do not serialize callbacks, AbortSignal, Blob or directory handles into Chrome JSON messages.
- Guidance/Badge: read/write Settings through Application. Store shown/acknowledged flags only after the actual UI event described in the design. Takeout guidance consumes only `partial_limit` + `provider_limit`.
- Explicit local cleanup buttons call Application rather than orchestrating Storage deletes in a view.

The remaining old UI/Content/Background callers are outside the six-module alignment scope. Removed Application entry points intentionally expose those remaining integration errors. Content's passive observation helpers remain unchanged; only its active scan orchestration moved here. Shared legacy type exports now point to Application's Record/ScanStatus definitions.

## Module Tier 1 validation

```sh
python3 tests/run_tests.py --filter application
```

These tests isolate external IO with the frozen Storage contract and L1/Delivery/PDF compiler doubles. They exercise the real Application workflow with real Composer, resource selection, MD/HTML/JSON renderers and Packaging/ZIP. They are not a claim of browser integration, actual PDF compilation, delivery persistence, or whole-repository type-check success. Run `npm run test:v2-modules` for all six migrated module suites, real Chromium Storage/Web Locks checks, cross-module export integration and scoped whole-program type checks. Whole-repository `npm test` remains required and its migration gaps must be reported.
