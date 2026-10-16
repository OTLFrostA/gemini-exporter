# AccountRegistry: first implementation stage

The [final AccountRegistry design](https://app.notion.com/p/3fb5d4d759e1811f8d00c0d6b26ff696) is the identity contract. This change establishes the registry and connects online discovery; it does not complete the Conversation, UI, Takeout or legacy storage migration.

## Current identity and persistence map

| Responsibility | Code | Behavior in this stage |
| --- | --- | --- |
| Gemini profile discovery | `src/content/accountSniffer.ts` | Reads Gaia `qDCSke` and email `oPEP7c` from the same active page's Wiz object; DOM labels supply display names only when their email agrees. Missing Gaia cannot establish a Registry account. |
| Provider normalization | `src/core/provider/gemini/accountObservation.ts` | Maps Gaia to `providerAccountId`; emits no slot, UUID or credentials. |
| Domain account identity | `src/core/domain/accountRegistry.ts` | Matches `(providerId, providerAccountId)`, preserves UUID and absent profile facts, never matches email, never generates IDs or performs IO. |
| Atomic persistence | `src/core/storage/accountRegistryStore.ts` | Uses an `accounts` store in the existing Domain IndexedDB. One read/write transaction covers lookup, pure decision, UUID generation and commit. Reads validate without data repair. No memory fallback. |
| Content/background boundary | `src/background/accountRegistryHandler.ts` | Validates extension sender and request; supports observe, list (optional Provider filter), and read by UUID. |
| MAIN-world evidence transport | `src/content/hookCredentials.ts`, `src/content/bootstrap.ts` | Publishes account discovery separately from credentials and carries captured identity with credential observations. Treats page messages as untrusted input. |
| Runtime UUID binding | `src/content/accountContext.ts`, `src/content/messageRouter.ts` | Holds a tab-local slot/visible-identity binding, returns a detached `AccountContext` through `getAccountContext`, invalidates switched contexts and superseded responses. |
| Credential identity | `src/content/bootstrap.ts` | Newly captured credential `accountId` comes from the Registry UUID; removes the `email || Gaia || slot` fallback. |
| Legacy account metadata | `src/core/storage/storageService.ts`, `src/types/ui.ts` | Existing `AccountSlots` display/count compatibility remains. New discovery does not write a UUID-to-slot registry here. |
| Legacy account selection | `src/ui/state/conversationsStore.ts`, `src/ui/views/accountView.ts` | Still selects the old slot-partitioned conversations, pending the separate storage/UI migration. |

## Deliberate implementation boundary

- Account facts contain only `id`, `providerId`, required `providerAccountId`, optional `email` and `displayName`. Different Providers or remote IDs remain different accounts even with identical email.
- Only the online observation admission path allocates UUIDs. This stage adds no manual creation or Takeout creation API. The existing Takeout flow still requires its later UUID selection integration.
- The database's physical version becomes 3 to add `accounts`; Conversation record/schema versions stay unchanged. Old account records and Conversation partitions are not automatically assigned to new UUIDs.
- Existing Sync `PageObservation.accountId`/Coverage and MAIN-world `requestAccountId` fields still represent the older source fingerprint. The Sniffer calls that fingerprint `identityKey` so it cannot masquerade as a local account ID. Converting those request paths to UUIDs and migrating their storage is subsequent work; current conversation writes still use their old slot scope.
- Runtime binding protects discovery/credential identity against delayed registration replies and visible account/slot switches. This stage does not claim that every existing list/detail/export path already uses UUID-scoped request attribution.

## Verification

Unit tests cover pure identity selection, schema constraints, normalization, UUID receipt binding, stale responses and account switches. Browser tests exercise the real MAIN/isolated/background boundary, cross-slot discovery, concurrent IndexedDB get-or-create, durable reads after reload, transaction aborts and malformed stored data. Real Gemini testing must separately validate actual Wiz fields and multi-account correspondence; synthetic fixtures alone do not establish Provider identity reliability.

## Live source findings (2026-10-15)

Read-only probes used the logged-in debug Chrome. Reports retain field names and equality checks, never actual identifiers, emails, tokens or full session payloads. These internal website fields are not a supported public API contract.

| Provider | Observed source | Finding and consequence |
| --- | --- | --- |
| Gemini | MAIN-world `window.WIZ_global_data` | `qDCSke` is a 21-digit Gaia candidate, equal to `S06Grb` and `W3Yyqf` in this sample. `oPEP7c` agrees with the current Google Account label's email. The old `oTI7oc` field is absent; `FdrFJe` is a different session identifier. Use the explicit Gaia/email tuple, not arbitrary numeric or email fields. |
| Gemini | Matching account DOM label | Supplies a display name only when the email agrees. An email prefix is not a confirmed display name. |
| Gemini | Final-code extension, background Registry and tab context | Exactly one stored Gemini account matches the current Gaia/email; the tab's local UUID matches that record, with slot `u0`. Actual multiple signed-in accounts and slot reordering remain unverified. |
| ChatGPT | `/api/auth/session`, `/backend-api/me` | Session `user.id` is a `user-…` login subject equal to `me.id`. Email, name and picture/image URLs are available. Repeated reads retain the same user ID. |
| ChatGPT | Session `account`, `/backend-api/accounts/check/v4-2023-04-27` | Session `account.id` is a workspace UUID equal to the returned `account_id`, distinct from the login subject. `account_user_id` is a third distinct value. The `default` entry aliases the same workspace, not a new account. |
| ChatGPT | Actual browser requests after page reload | `/backend-api/conversations`, `/backend-api/me` and Accounts requests carry `Chatgpt-Account-Id` equal to the current workspace ID. The scaffold's token-only requests do not establish correct multi-workspace attribution. |
| ChatGPT | Account and session metadata | Structure, plan, roles, MFA and authentication information exist, but do not belong to the minimal Registry account. Only one personal workspace was available for verification. |

ChatGPT's `providerAccountId` mapping is deliberately not activated: login subject and workspace are separate scopes. Before connecting its discovery or conversations, define the export isolation scope and verify multiple-workspace requests, including whether two users sharing a workspace may share local history. A user-scoped Account would still need workspace attribution for requests/conversations. No generic User/Workspace/Membership model is added from this single sample. The existing ChatGPT provider remains unregistered with optional hosts; permissions are unchanged.

The first full live Tier 2 run completed all 25 stages: 24 passed and the structured/Markdown differential audit failed (14 of 18 replies differed). Replaying the exact same captured evidence using a clean `main` worktree reproduced the identical 14 differences. Neither parser nor differential-check code changes in this implementation; this is a reproduced baseline limitation, not a passing Tier 2 result. The final-code run is recorded separately when complete.
