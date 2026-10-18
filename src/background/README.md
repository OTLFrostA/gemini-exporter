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
- `getLocalIndexCount`: Content receives `(await listIndexes(accountId)).length`
  only after its sending document confirms the requested current Account.
- `runLiveSave`: Content sends only a ConversationKey. The worker checks Settings
  and directory permission, verifies the sending document's current Account, and
  calls Application `runExport`. Disabled/non-Markdown
  returns `result: null`; actual Export results and failures are preserved.
  The completion event supplies a frozen ConversationKey before any debounce;
  neither the Observer nor Coordinator rediscovers its Account.
- `ensureV2Ready`: the worker directly awaits its shared migration promise; other
  contexts use IPC. Content registers passive listeners immediately, and the
  Registry/L2 ports wait for readiness when an event accesses data.
- `openOptions`, `openGeminiPage`, `reloadGeminiTab`: bounded navigation only.
- Content resource ports: `getFileBlob` / `getImageBlob`, with Account rechecking
  and a bounded JSON response. L1 still owns resource acquisition.

`resolveAccountTab(accountId)` only considers Gemini, the Provider with production
Content injection. The target is fixed before dispatch; Content rechecks the UUID.
Active worker operations also check the sender Tab/document using
`getAccountContext`. Passive ingestion retains the captured request identity and
does not require that historical request to match the current Tab Account.
No first-Tab fallback, persistent cancellation flags, batch queue or export proxy
remains. Scan callbacks and cancellation stay in the calling Application context.

## Integration dependencies

This module implements the frozen Notion contracts independently of other v2
modules. On base commit `25d72799`:

- Migration's `core/migration/upgradeV1.ts` / `ensureUpgraded(): Promise<void>` is
  absent. Runtime intentionally imports that contract and does not replace it
  with a no-op or a legacy database reader. Production compilation/readiness needs
  the Migration module implementation.
- Lifecycle uses the existing Settings `tourShown?: true` field. Install leaves it
  unset and opens Options; UI sets it after first displaying Tour. Update sets it
  true without opening Options. `lastSeenFeatureVersion` independently controls
  Feature Spotlight, preserving any existing version. No schema/compatibility change.
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

The 55-case suite exercises commit waiting and failure, empty pages, sender/Provider/UUID
validation, strict Tab routing, Live Save request/results and permission loss,
readiness sharing/retry, paired Popup context, resource response checking,
installation Settings, directory gestures, confirmed completion and reinjection
cleanup, immediate capture during readiness, frozen completion identities and
CI script references. External owner contracts are stubbed at the module boundary, including
the missing Migration entry point.

Only this module's Tier 1 was run. Whole-repository tests, other modules' suites,
real Chrome and Tier 2/3 were excluded as requested. The tests do not establish
real browser permission persistence, service-worker survival or production E2E.

## Completion evidence and commit ordering

Fetch and XHR share the same conservative success predicate: a successful HTTP
response, fully read within the capture cap, complete JSON frames with a consistent
conversation/response identity, answered candidates (`candidate[8][0] === 2`) and
a history-save marker (`inner[25]`). HTTP 200, EOF, loadend, DOM idleness, navigation
and unload alone prove nothing. Abort, reader/clone errors, protocol errors and
truncation do not emit completion. XHR terminal listeners are removed together;
MAIN reinjection and repeated response identity cannot duplicate a completion.
Truncated Fetch clone cancellation is not awaited, since a tee may wait for the
page's other branch to finish.

Protocol evidence is documented by the independent Gemini client at
[commit 1ad0d4a, client.py lines 1661–1666 and 1723–1725](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/client.py#L1661).
The tests use explicitly synthetic protocol frames, not a captured Chrome corpus.
Unknown protocol endings conservatively suppress Live Save. The Hook only observes
completion signals; it does not compose Domain facts or decide Export Skip.

MessageBridge waits for the commits of source captures already received before a
completion notification. This is a barrier over existing admission Promises, not
a queue or another execution pipeline. A failed commit suppresses that notification;
old-instance completion cannot invoke a newly injected listener. Captured passive
requests retain their original Account attribution.

## Cross-module investigation / handoff

- **L1 + Application stale Skip (reproduced):** DOM `parseIndex.ts` does not return
  `updatedAt`. Application `export/runExport.ts` checks the ExportRecord against
  Index.updatedAt before reading or refreshing Detail. A newly committed Detail
  with an unchanged Index can therefore be skipped. Runtime must not invent a
  timestamp, override `skipUnchanged`, or implement its own Skip policy. L1 owns
  authoritative update facts; Application owns Skip ordering/policy. The regression
  runs real Application/composition/Markdown/Packaging: with an authoritative new
  Index timestamp and a delayed observed Detail commit, Live Save writes the latest
  reply after an earlier successful export. A separate characterization reproduces
  the stale-Index defect. Captures arriving only *after* completion are outside the
  already-received commit barrier; freshness still depends on those owner contracts.
- **Dead Content writers removed:** `geminiIndexCapture.ts`, `domScraper.ts` and
  `syncEngine.ts` had no v2 production callers and formed an obsolete Content scan /
  direct-ingestion path. Their script references and unused MAIN test-sync hook are
  removed. Active Content Domain writes now use only `domainIngestion`. Badge's
  legacy position Storage calls remain a UI migration dependency, not a Domain
  admission port or a reason to restore old Runtime actions.
- **L1 file resource limit (confirmed defect):** `assetFetcher.handleGetFileBlob`
  reads a Blob and calls `toDataUrl` without a pre-conversion cap. L1 must bound
  reading/conversion before allocating Base64. Runtime cannot repair that earlier
  allocation by checking a completed DTO. `handleGetImageBlob` does cap the normal
  Base64 path before conversion; its `preferBuffer` branch is not requested by the
  Runtime JSON route. Image DTOs repeat Base64 in three fields: Runtime now checks
  the aggregate flat JSON upper bound (60 MiB, including escaping), before handing
  it to Chrome serialization, and rejects unsupported binary/nested responses.
  This uses no JSON.stringify copy and adds no large-file transfer framework.
- **External compilation dependencies:** Migration's missing `upgradeV1` import,
  Badge/UI's removed Storage APIs, legacy L1 transport/parser types and UI export
  controllers still prevent integrated compilation. Scoped checking reports no
  new owned Runtime type errors beyond the missing Migration contract. No owner
  code, missing implementation stubs or old UI compatibility routes were added.

The Runtime Tier 1 suite retains the original 29 tests and adds protocol failure,
read/abort/truncation, XHR completion, admission ordering, latest Markdown,
stale Skip and aggregate resource-boundary regressions. These are module tests,
not proof of real Chrome wire compatibility, Folder Handle persistence or worker
survival. Production E2E acceptance remains pending the owner migrations and Chrome
validation; the reproduced external stale Skip and file-conversion defects remain.
