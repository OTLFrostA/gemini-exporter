# Sync list coverage and early-stop evidence

The live Gemini web app requests MaZiqc separately with `[31, null, [1, null, 1]]`
(pinned) and `[31, null, [0, null, 1]]` (recent). The existing client uses page
size 50 and the recent filter. An exhausted recent cursor cannot certify all
conversations because pinned chats move to the other chain.

On 2026-10-10, the dedicated test Chrome returned 319 recent conversations in
seven pages. Pinning a test conversation removed it from recent history after
the change settled: 318 recent conversations plus one pinned conversation.
Renaming that pinned conversation changed its authoritative RPC title without
changing its timestamp (`1791692619701`). The test title and pin were restored.

Consequently, descending timestamps in the observed recent list establish only
activity ordering. They do not establish ordering of every metadata mutation.
Neither crossing the prior head timestamp nor finding repeated IDs proves an
unchanged tail. Sync continues through both cursor chains; rapid overlap stops
remain disabled. No parser, merge algorithm, detail fetch or export changes are
needed for this fix.

`includePinned` reuses the existing pagination loop, parser and page callback.
The total page budget covers both chains. Tokens reset between chains while ID
deduplication spans the aggregate. Empty pinned history proceeds to recent
history; malformed responses, limits, cancellation, cursor loops and budgets
remain incomplete. Every valid page, including an empty pinned page, is
acknowledged before Coverage can advance. Version 2 invalidates the older
recent-only Coverage without deleting conversation archives.

Regression coverage checks independent tokens, pinned-only and empty-pinned
accounts, cross-list duplicates, all interruption reasons, invalidation of
version 1, a later-page rename without a timestamp change, and the real Sync
button through the packaged extension and physical Chrome storage.

Final-tree validation: `npm test` passed, including all 82 Playwright tests.
The dedicated Chrome Sync button was then exercised twice against the real
account: pin and rename the existing test conversation, then restore its title
and unpin it. Both scans exhausted eight pages and covered 319 conversations;
physical Chrome storage contained the expected title, unchanged server timestamp,
listed availability and complete version 2 Coverage (revisions 1 and 2).
The live test waits for the server to acknowledge mutations before asserting a
stable-list scan, since an optimistic sidebar update precedes that acknowledgement.
