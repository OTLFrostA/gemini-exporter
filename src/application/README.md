# Application

Implements the frozen [Application design](https://app.notion.com/p/3fb5d4d759e181169ed3dfed880a093a).

- `scanAll`: Recent scan, one startup Coverage snapshot, committed-page counters
  from L1 and trusted boundary decisions from L2. No persistent scan session.
- `runExport`: sequential refresh/read/compose/prepare/format/deliver/record workflow
  shared by Popup, Options and Background Live Save. Task Provider construction
  belongs to L1. Local reads are validated by L2 before composition.
- `getSettings`, `updateSettings`, `isLiveSaveEffective`: defaults and explicit
  patches; ineffective Live Save does not reset the user's enabled preference.
- `clearLocalExportRecords`: clear export history only.
- `clearLocalScanRecords`: clear Coverage and export history, retaining Index,
  Detail, accounts, files and directory handles.

Browser output with multiple physical files automatically becomes ZIP. Folder
output writes each conversation group and finalizes its ExportRecord only after
actual delivery. Cancellation preserves records for already delivered groups.
There is no `useZip` option or alternate Live Save writer. Live Save submits
Markdown + Folder Writer with `skipUnchanged: false` after a changed passive Detail
commit or a verified reply-completion event. Following the 2026-10-20 design decision,
reply completion requires an answered candidate and a complete successful response,
without a separate cloud-history persistence token. It sets `refreshDetail: true`
on unified Export: Application acquires
full source Detail through L1 Client, then rereads accepted L2 Domain before export.
Sniffer only observes and admits facts; it never initiates acquisition. With disk
saving disabled (or a different default format), verified completion still calls
Application `refreshConversation` to update L2 source facts and the updated badge,
without resource download, file delivery or an ExportRecord write. Passive Detail
events do not trigger active acquisition. An unavailable writable directory fails
before the disk-export workflow starts. Same-Key
saves are serialized with coalesced trailing events so later replies are retained.
A transient refresh failure may export usable cached Detail as partial; confirmed
remote deletion never falls back. Application owns workflow and record decisions.

`python3 tests/run_tests.py --filter application` runs workflow unit tests with
external IO doubles. `npm test` also runs cross-module suites and production
browser integration, including real downloads, ZIP, PDF sandbox and a stored
native directory handle. Fixture network tests do not establish live Google
protocol compatibility or service-worker survival across browser restarts.
