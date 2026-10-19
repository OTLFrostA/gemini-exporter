# UI v2

Implements the frozen [UI design](https://app.notion.com/p/3fb5d4d759e181cdad0fc2f778766999).
This migration targets `dev/v2` and deliberately does not repair adjacent modules.

- Popup: trusted current Key, four formats, short final result, Options navigation.
- Options: account-scoped read mirror and explicit selection; one Sync, Export and
  Takeout entry; two record cleanup actions; Settings and directory gestures.
- Guidance: installation URL intent is consumed immediately, Tour has no durable
  fields, Spotlight/Takeout acknowledge only actual display and dismissal.
- `src/content/badgeView.ts`: UI despite its Content location. Account-bound count,
  final Live Save result, Settings position, drag, keyboard and cleanup.
- `src/content/liveSaveCoordinator.ts`: only its UI feedback callbacks changed;
  the existing Runtime execution and trigger semantics are otherwise untouched.

No UI Domain ingestion, source parsing, Coverage/Skip decisions, file formatting,
ZIP choice, delivery, success bookkeeping, persistent sessions or v1 compatibility.
The previous UI modules and views implementing those responsibilities are removed.
Historical v1 UI tests still target deleted APIs; do not retain those APIs to satisfy
those tests. Cross-module fixtures and gates are left to their owners.

## Verification

`node scripts/test-ui.cjs` runs UI-owned type diagnostics, UI unit tests and UI-only
headless browser tests. Other modules' type diagnostics are counted and excluded.
For environments requiring separate browser authorization, run:

```
node scripts/test-ui.cjs --types-and-unit
npx playwright test tests/e2e/ui_v2.spec.ts --workers=1
```

Browser specs bundle the real UI and mock only Application, Domain, Storage and
Runtime ports. They test actual browser hit testing, not a live Google account.
No other module tests, full repository gate, Tier 2 or Tier 3 were run.

## Adjacent owner handoff (base 8db0a4ec)

1. **Runtime:** implement `resolveScanTarget(preferredAccountId?)` in
   `core/utils/tabService.ts` per the frozen Runtime spec. UI calls this port and
   displays an explicit error if it is absent; it never guesses a source or opens
   a tab as a side effect of Scan.
2. **Application:** export `clearLocalScanRecords(accountId)` from `localCleanup`.
   UI calls that single operation and never substitutes account deletion or its
   own multi-table cleanup. Until provided, the button reports unavailable.
3. **Application/L4:** remove the required `ExportRequest.useZip`. UI submits the
   frozen request without that field. One localized `@ts-expect-error` documents
   the present type mismatch; remove it when the owner updates the contract.
   Browser multiple-file packaging and Folder grouping remain upstream duties.
4. **Runtime:** call `BadgeView.refreshAccount()` after existing account identity
   notifications, and `BadgeView.refreshIndexCount(accountId)` after already
   observed successful Index commits. The Badge initializes itself and consumes
   existing route events, but does not add polling, a new observer, or a bus.
   Runtime also owns installation `?startTour=1` and feature baseline initialization.
5. **Settings/schema owners:** retire old `useZip`/Tour fields and migrate legacy
   data as specified. UI neither reads nor writes those fields.

The existing `getAccountContext` response already supplies `conversationId`, and
Background already exposes `getLocalIndexCount`; their implementation is unchanged.
These UI tests establish the UI side of those contracts, not full system integration.
