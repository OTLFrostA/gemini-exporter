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

## 2026-10-12: timestamp evidence and exhaustive traversal are independent

The current official runtime maps list protobuf field 6 (JSON `row[5]`) to
`timestamp` and sorts the displayed recent list by that value. This does not
establish that the wire array or pagination cursor is sorted by the same field.
The real account returned one inversion across 350 recent conversations using
50-row pages. A 40-row head also placed an older timestamp at its end followed
by a newer timestamp on the next page. The native 31-row head plus 20-row next
page returned the same affected conversation at its chronological position.
The affected list timestamp and candidate ID match its older detail turn;
its exact server-side ordering semantics remain unverified.

Coverage now certifies natural exhaustion from the contiguous, valid,
duplicate-free cursor chain, independently of timestamp ordering. Unknown
request/account context, malformed or truncated pages, conflicts, loops and
missing links remain unable to certify exhaustion. A terminal scan status also
requires both streams' current cursor-chain proof under the storage write lock;
an older `historyComplete` value alone cannot certify a new scan.

Observed within-page or cross-page ordering failures persist
`orderingInvalidated: true` with `range: null` for that account's coverage
generation. Later ordered active/passive pages and new sessions cannot restore
time-overlap early stopping. Such accounts use exhaustive follow-up scans;
normal verified ordered coverage retains incremental completion. This is a
conservative response to observed counterexamples, not a claim to have proved
Google's global timestamp/cursor ordering contract.

Tier 2 keeps genuine incremental closure assertions and additionally verifies
exhaustive fallback only when durable ordering invalidation exists. Both paths
still require saved new/promoted activity, preserved archives and export
records, and same account/generation. The fallback must reach the actual final
page with complete durable pinned/recent coverage; it is never reported as an
incremental early-stop success. No test stage is skipped.

Final validation on 2026-10-12: `npm test` passed with all 94 Playwright
tests. Full `npm run test:tier2` passed all 24 features with zero failures,
skips or warnings. The fresh baseline was ordered (eight pages, 350 chats);
new/promoted activity retained the two-page incremental path. The post-import
full scan exhausted nine pages and 352 chats, then its two-page follow-up
passed. Within-page/cross-page inversion and sticky fallback were separately
covered by parser/storage/session and packaged-extension regressions.
Physical exported Markdown matched all seven actual turns in the first new
chat (including two continuation prompts) and all five in the second; image
and file resources, HTML/PDF exports and all lifecycle checks passed. The
scenario pool was replenished to 20 with two distinct new domains.
