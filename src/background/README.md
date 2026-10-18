# Browser Runtime v2

Runtime owns Chrome execution contexts, IPC, account-bound Tab routing, page hooks,
permissions, installation and cleanup. Domain admission, scan policy, formatting,
folder writes and export records remain with their existing owners.

## Ports

- `domainIngest`: Content calls the two L2 signatures through
  `core/api/domainIngestion.ts`. The worker awaits actual L2 admission, including
  empty Index pages. Extension callers use L2 directly after readiness.
- `accountRegistry`: Content resolves stable Provider identities through the
  existing L2 registry. UUIDs are never replaced by account slots.
- `getAccountContext`: Content returns the Account and current conversation from
  the same page read. Account changes during the read fail the request.
- `getLocalIndexCount`: Content receives `(await listIndexes(accountId)).length`.
- `runLiveSave`: Content sends only a ConversationKey. The worker checks Settings
  and directory permission and calls Application `runExport`. Disabled/non-Markdown
  returns `result: null`; actual Export results and failures are preserved.
- `ensureV2Ready`: all contexts await the worker-owned migration promise.
- `openOptions`, `openGeminiPage`, `reloadGeminiTab`: bounded navigation only.
- Content resource ports: `getFileBlob` / `getImageBlob`, with Account rechecking
  and a bounded JSON response. L1 still owns resource acquisition.

`resolveAccountTab(accountId)` only considers Gemini, the Provider with production
Content injection. The target is fixed before dispatch; Content rechecks the UUID.
No first-Tab fallback, persistent cancellation flags, batch queue or export proxy
remains. Scan callbacks and cancellation stay in the calling Application context.

## Integration dependencies

This module implements the frozen Notion contracts independently of other v2
modules. On base commit `25d72799`:

- Migration's `core/migration/upgradeV1.ts` / `ensureUpgraded(): Promise<void>` is
  absent. Runtime intentionally imports that contract and does not replace it
  with a no-op or a legacy database reader. Production compilation/readiness needs
  the Migration module implementation.
- Settings still declares `tourShown`. Lifecycle now writes the specified
  `tourAutoHandled` field; Settings/Guidance must adopt their frozen schema.
- Legacy UI/other callers and v1 regression tests still refer to removed
  `fetchBatch`, persistent Slot cancellation, direct `domainStorage`, full-chat
  Live Save, or Content detail/scan orchestration. Those owners must use the v2
  Application/L1 APIs. There is no compatibility execution pipeline here.
- Badge's UI, counts rendering, Settings position handling and pointer cleanup
  remain in the Badge module. Runtime provides its read-only count port and
  initializes/tears down the existing component.

## Module Tier 1

```sh
node -r ./tests/ts_register.js --test tests/browser_runtime_v2.test.ts
```

The suite exercises commit waiting and failure, empty pages, sender/Provider/UUID
validation, strict Tab routing, Live Save request/results and permission loss,
readiness sharing/retry, paired Popup context, resource response checking,
installation Settings, directory gestures, confirmed completion and reinjection
cleanup. External owner contracts are stubbed at the module boundary, including
the missing Migration entry point.

Only this module's Tier 1 was run. Whole-repository tests, other modules' suites,
real Chrome and Tier 2/3 were excluded as requested. The tests do not establish
real browser permission persistence, service-worker survival or production E2E.
