# AccountRegistry and UUID attribution

The [AccountRegistry design](https://app.notion.com/p/3fb5d4d759e1811f8d00c0d6b26ff696) defines the current identity contract. Registry UUIDs own all conversation indexes, Domain bodies/resources, export records, synchronization state and UI selection. Provider routing values such as Gemini `u0` never identify a local storage partition.

## Account contract

`src/core/domain/accountRegistry.ts` defines the only durable account entity:

```ts
interface Account {
    id: string; // local UUID v4
    providerId: string;
    providerAccountId: string;
    email?: string;
    displayName?: string;
}
```

Matching uses the exact `(providerId, providerAccountId)` pair. Email and display name update the profile without changing the UUID; missing profile fields preserve known values. Email is never a matching key. Gemini uses Gaia as `providerAccountId`; ChatGPT uses `JSON.stringify([userId, workspaceId])`.

Each Provider can have one ordinary fallback Account with `providerAccountId: 'default'` and its own UUID. Missing reliable Provider identity resolves to this Account. Unverified email/name is discarded for default. Unknown sources can share its archive scope; later discovery creates/reuses the real Account without moving, promoting or merging default data. A missing request capture is a protocol error, distinct from an explicitly captured unknown identity.

## Definitions and consumers

| Responsibility | Implementation | Contract |
| --- | --- | --- |
| Pure account rules | `src/core/domain/accountRegistry.ts` | Validate Account fields/UUIDs, reject duplicate identities, find existing Account and update profile. No IO or ID generation. |
| Atomic persistence | `src/core/storage/accountRegistryStore.ts` | `getOrCreateAccount(providerId, providerAccountId, email?, displayName?)`, `listAccounts(providerId?)`, `getAccount(id)`. Lookup, UUID allocation and writes commit in one IndexedDB `accounts` transaction across tabs. No memory fallback or receipt model. |
| Background/API boundary | `src/background/accountRegistryHandler.ts`, `src/core/api/accountRegistry.ts` | Validate extension sender, requests and replies; wait for storage initialization. Broadcast `accountsChanged` after durable changes. |
| Provider discovery | `src/content/accountSniffer.ts`, Provider `accountObservation.ts` modules | Normalize reliable Provider facts into temporary Account parameters. Parsers and Providers do not allocate local UUIDs. |
| MAIN-world capture | `src/content/hookCredentials.ts` | Capture immutable identity and routing before Fetch/XHR send, publish SPA profile changes, answer correlated current-identity queries. Ordinary network requests do not trigger DOM profile scans. |
| Runtime binding | `src/content/accountContext.ts`, `src/content/bootstrap.ts` | Resolve current or captured Provider facts through Registry; coalesce identical updates, retain committed UUID during same-identity profile updates, reject superseded bindings. Credentials reference the UUID; routing stays separate. |
| Request admission | `src/content/messageBridge.ts`, `src/content/messageRouter.ts`, `src/content/syncEngine.ts`, `src/content/liveSaveCoordinator.ts` | Resolve UUID before persistence. Request captures resolve ownership without replaying stale profile hints over newer live observations. A late passive response from A remains A's response after the tab switches to B. Active page/DOM work checks the current binding and routing before use. |
| Tab routing | `src/core/utils/tabService.ts` | Ask each tab for fresh account context, match the requested UUID and pass it back in commands so a subsequent switch cannot redirect work. URL slots alone do not prove identity. Direct asset requests also carry the UUID, and the content router checks the binding before acquisition and again before returning bytes. |
| Storage partitions | `src/core/storage/storageService.ts`, `src/core/storage/domain/` | UUID required. Local keys: `conversations_<UUID>`, `exported_<UUID>`, `last_sync_<UUID>`, `last_count_<UUID>`, `scan_coverage_<UUID>`, `scan_checkpoint_<UUID>`. Domain identity: `{providerId, accountId, conversationId}`; physical tuple key uses all three. Deletion intents and media caches use the same UUID scope. |
| Workbench/Popup | `src/ui/state/conversationsStore.ts`, `src/ui/views/accountView.ts`, Options/Popup modules | Account list comes solely from Registry; selection stores a UUID. Counts derive from that account's conversation data. An empty Options page does not create an account. Later loads supersede earlier snapshots, and completions of deletion/reconciliation in A cannot change visible account B. |
| Takeout | `src/ui/controllers/takeoutController.ts`, `src/core/engine/takeoutEngine.ts` | Import into a selected existing Gemini UUID. With no Gemini Accounts, create/reuse Gemini default. With existing accounts and no valid selection, require selection. Engine validates existence and Provider before parsing or writes. |
| Export | Export orchestration, pipeline, PDF and session recovery | Carry the selected UUID into list/body/resource reads and export-record writes. Internal parameters still named `slot` in a few helpers contain a UUID, never `u0`. |

Provider/parser output contains conversation identity and content. Runtime supplies the resolved enclosing Account scope when admitting that output to Storage; local UUID allocation is not embedded into pure parsing.

## Clean schema boundary

Current storage schema is version 3. Initialization creates current stores and stamps fresh storage. Unsupported stored schema versions fail; no old account fingerprint, slot partition, alias read, dual write, AccountSlots map, default promotion or migration is provided. Existing legacy-format conversation parsing is a content adapter, not an account identity fallback. The standalone historical release-upgrade harness still describes its old-profile baseline and is not acceptance evidence for this deliberately incompatible schema.

## Provider evidence and limits

Read-only probes of logged-in debug Chrome on 2026-10-15 retained field names/equality checks, not actual identifiers, email, tokens or full session payloads. Website fields are internal implementation details.

| Provider | Observed source | Finding |
| --- | --- | --- |
| Gemini | MAIN `WIZ_global_data` | `qDCSke` is the Gaia candidate, agreeing with `S06Grb`/`W3Yyqf` in the sample. `oPEP7c` is current email. `oTI7oc` was absent; `FdrFJe` is a different session identifier. |
| Gemini | Account DOM labels | Supply a display name only when their email agrees with the MAIN profile. Arbitrary DOM email can describe another signed-in account. |
| ChatGPT | `/api/auth/session`, `/backend-api/me` | Session `user.id` equals `me.id`; email, name and image URLs are available. |
| ChatGPT | Session `account`, `/backend-api/accounts/check/v4-2023-04-27` | Workspace `account.id` equals returned `account_id`, distinct from the user subject and `account_user_id`. The `default` entry aliases the workspace. |
| ChatGPT | Actual list/me/accounts requests | `Chatgpt-Account-Id` carries the current workspace ID. Token alone does not establish workspace routing. |

Only one Gemini signed-in account and one ChatGPT personal workspace were actually inspected. Controlled switch/concurrency tests do not establish real multi-account or team-workspace behavior. ChatGPT normalization is unit tested; its online scaffold remains disabled and has not been integrated with live workspace-aware Registry admission. Enabling it requires real list/detail/attachment routing validation. No generic User/Workspace/Membership entity is introduced.

## Verification scope

Account regressions exercise pure matching/default rules, profile retries/coalescing, malformed replies, atomic concurrent creation and transaction aborts, durable reloads, SPA switching, and native Fetch/XHR list/detail responses released after a switch. Default tests cover Provider isolation and verify that later real identity does not promote default. UI/import/export/deletion tests use explicit current-schema Registry Accounts and UUID partitions.

Historical Tier 2 runs on earlier commits are not current-head validation. Prior failures included vanished debug targets and an independently reproduced Canvas/webpage-evidence discrepancy; parser output on clean main and the earlier branch was byte-identical for that captured input. Current validation results belong in the PR, with failures and incomplete live coverage reported explicitly.

## Live acceptance status (2026-10-16)

After manual completion of Google's verification, the full 25-feature Tier 2 run passed on code commit `d0784aee`: **24 PASS, 0 FAIL, 0 SKIP, 1 nonblocking WARN**. No feature/domain filter or skip flag was used. The run reused the two five-turn scenarios from the earlier attempt through `--dataset`; all configured turns and subsequent append/update stages ran.

Coverage includes genuine webpage RPCs, full 10-page synchronization (419 conversations), incremental closure, both generated conversations with a real CSV upload, cloud deletion with local archive retention, Takeout/title upgrade, live save and old-conversation promotion, physical Markdown/HTML/PDF content, seven-conversation ZIP/image/attachment assertions, skip-exported behavior, stale-tab image export after reinstall, and uninstall/reinstall isolation. The formerly failing stale-tab case passed with the fresh source tab's Registry UUID. The dual-parser audit compared 18 replies: 9 matched, 9 differed, and none lacked structured output; differences remain nonblocking audit evidence under the agreed policy.

Local evidence is saved in the ignored `tests/output/account_registry_verified_retry/` directory, including `run.log`, `dataset.json`, exported ZIPs, extracted files, synchronization/image evidence and `gemini_dual_parse/report/REPORT.md`. Earlier attempts failed through fallback-account selection or Google's verification redirect; they are superseded by this complete successful run, rather than counted as passes.

Local acceptance on the final source/test tree: `npm test` passed (scoped zero-any, TypeScript, Python checks, 283 TypeScript unit suites, production build and 105 Playwright tests). `python3 tests/test_tier2_assertions.py` passed 88 tests. The live-save UI suite passed 20/20 across five repeats after waiting for the existing asynchronous settings-binding signal before changing storage. The scenario pool remains 20/20. GitHub checks on `d0784aee` also passed. ChatGPT online and real multiple-account/workspace behavior remain unverified.
