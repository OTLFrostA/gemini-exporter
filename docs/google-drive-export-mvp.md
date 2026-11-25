# Google Drive document export — experimental MVP

This is an opt-in **readable document export** to support the user's own
cross-AI knowledge library, not the encrypted Vault, database backup, restore,
or bidirectional sync. The checked-in public manifest intentionally has no
OAuth client or new permission. The experimental card remains hidden until a
development manifest configures the client.

## Try in an isolated development Chrome profile

1. Enable Drive API in a dedicated Google Cloud project. Create a Chrome
   Extension OAuth client for the actual ID of the unpacked development build.
   Configure the consent screen and test users. Do not reuse the CWS analytics
   client or commit secrets. Chrome Extension OAuth client IDs are public.
2. In a disposable local copy of the manifest (never commit this test-only
   permission expansion), append `identity` and `alarms` to permissions;
   add `https://www.googleapis.com/*` to host_permissions; set
   `oauth2: { "client_id": "<development-client-id>.apps.googleusercontent.com",
   "scopes": ["https://www.googleapis.com/auth/drive.file"] }`.
3. Build, load unpacked, select an identified source account in Options,
   click Connect on the experimental Drive card, grant authorization, and
   verify the actual source and destination in the confirmation. Cancel if
   they are not correct. This creates a dedicated folder in My Drive.
4. Click Export now or let the five-minute alarm run with Chrome open.
   Open the created Markdown files in Drive. Check whether another AI's
   independently authorized connector can discover/read the files.
5. Add a reply to a source conversation, confirm it is fully captured locally,
   rerun export, and verify the same file ID is updated. Try disconnect,
   wrong Google account, OAuth revocation, worker termination and lost upload
   responses. Use synthetic conversations, not personal history, for tests.

## Scope and invariants

- Explicit opt-in for exactly one identified source Account UUID and one
  verified Drive permission ID; every run checks the real Google account.
  All complete locally collected conversations for that source are in scope.
  Other source accounts may still be captured **locally** by existing capture
  behavior but cannot be uploaded by this binding.
- Standard readable Markdown via existing Domain admission, composition and
  renderer. No original attachment bytes or resource acquisition, no source
  RPC from the Drive exporter, no plaintext/credentials sent to developer
  servers. Source links/text contained in the user's conversation are exported.
  Incomplete/in-flight/stale local snapshots are skipped, not used to replace
  a prior document. Missing history must first be captured using existing tools.
- One app-created folder per connection. Local receipt keys are scoped by
  folder and hashed local Account + conversation identity. Reserve and persist
  the Drive file ID before upload; validate file ownership markers/parent before
  PATCH. Receipt success follows confirmed write. Reconciliation reads current
  local facts instead of claiming to be a durable change-event log. It retries
  on subsequent alarms, including when a response or worker was interrupted.
- Single-device writer, single active binding; run lock and per-document
  connection lock serialize writes and disconnection. Existing Drive documents
  remain after disconnect or source deletion. Reconnecting creates a new
  folder; no cross-install mapping recovery. Independent Drive edits to
  generated files can be overwritten when source content changes. Trashed or
  moved known files are not silently recreated. No conflict merge.
- 5 MiB multipart request limit, fixed Google origin, noninteractive background
  OAuth, no server token store. Manual reconnect may be needed after
  revocation; no upload while browser is shut down. Full scan every five
  minutes is deliberately simple; add bounded incremental scheduling and
  richer failure diagnostics before wide rollout. Only locally captured
  complete conversations are eligible; skip count is not a complete-backup claim.

## Release gates (not satisfied by this PR alone)

- Run full repository gates and actual development-client OAuth, two-account
  isolation, alarm restart, create/patch failure and response-loss tests.
- Verify format discovery with the intended AI connectors; consider native
  Google Docs separately if Markdown indexing is insufficient.
- Review permissions, bilingual disclosure and existing store/website privacy
  practices. Production OAuth client and Google policy applicability remain
  unverified. The Drive API terms distinguish export/document use from
  potentially restricted backup use; present actual automatic export behavior
  accurately and obtain clarification where required. Do not treat OAuth
  verification as special-use permission.
- No auto-merge or publication requested for the initial draft.

References:
https://developers.google.com/workspace/drive/api/terms
https://developers.google.com/workspace/drive/api/guides/api-specific-auth
https://developers.google.com/workspace/drive/api/guides/manage-uploads
https://developer.chrome.com/docs/extensions/reference/api/identity
https://developer.chrome.com/docs/extensions/reference/api/alarms
