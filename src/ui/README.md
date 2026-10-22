# UI v2

Implements the frozen [UI design](https://app.notion.com/p/3fb5d4d759e181cdad0fc2f778766999).

Popup exports the trusted current key. Options maintains an account-scoped read
mirror and explicit selection, calling Application for Scan, Export, Takeout,
Settings and two record-cleanup actions. Clearing scan records keeps all archived
conversations, accounts, files and directory handles.

Installation Tour consumes `?startTour=1` immediately; it has no persistent flag.
Version Spotlight is recorded on actual display (once per upgrade, never on fresh install); Takeout acknowledgment follows dismissal. The Content Badge owns its account-scoped count display and Pull: it refreshes
after account recognition or change, when a hidden page becomes visible, and
approximately every 60 seconds while visible. Background only serves the existing
read-only count IPC; there is no index-commit push or second count store.

Formatting, Skip, delivery and ExportRecords belong to Application and its
upstream modules. Browser multiple-file output automatically becomes ZIP; the UI
does not choose packaging. Scan resolves a verified online account through Runtime.

The Options sidebar displays **Browser download** and **Save to local folder**
as two always-visible radio choices. The local folder card has two aligned rows
for folder authorization and **Live Save**. When browser download is selected,
both controls are disabled and grayed out; background Live Save also pauses.
The chosen destination persists as Application `exportDelivery` Settings. Returning
to the local folder resumes the saved Live Save preference if Markdown is selected
and folder permission is valid. Switching to other formats pauses without
discarding the enabled preference.

`node scripts/test-ui.cjs` runs whole-project TypeScript, UI unit tests and UI
browser specs. Those specs mock owner ports. `tests/e2e/production_v2.spec.ts`
separately loads the built extension and exercises real Application/Storage,
downloads, PDF sandbox, passive capture and Background Live Save with fixture
network responses. Both are Tier 1, without a live Google account.

Theme preference is stored with Global Settings (`theme: 'dark' | 'light'`); existing installations
default to the original Dark UI. Popup and Options share the switch and Light palette.
The content Badge applies the preference to itself without changing Gemini's page theme.
