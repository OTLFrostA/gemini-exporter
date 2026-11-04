# React workbench trial

This branch evaluates React in one complete Options region: the conversation
list. It is an experiment, not a completed migration of the workbench.

## Ownership

- `views/listView.ts` is the migration boundary. It takes the existing
  `ConversationViewState`, builds typed row facts, handles selection intent, and
  updates the existing external selection summary/select-all/export controls.
- `views/conversationList.tsx` declares the list, rows, source-generation notes,
  export badges and attachment details. React exclusively owns `#list` children.
  Keys include both account and conversation IDs. Native details and checkbox
  nodes survive ordinary refreshes; another account gets a new identity.
- `ResourceAuthorization` owns its permission query and click feedback. Its
  effect cancels a late query result after unmount. Permission requests start
  directly in the user's click; granting access does not trigger an export.
- Application, Domain, Storage, Background, content capture and export workflows
  retain their existing APIs. React does not own persisted business facts.

The adapter uses `flushSync` because existing workbench/guidance code reads the
DOM immediately after rendering. This is a deliberate transitional boundary,
not a pattern for future React components. Page cleanup unmounts the root. Explicit `conversation-selection-change`
notifications bridge React row/title selections to the existing tutorial, which
previously observed native checkbox change events only.
Selection remains in the existing store rather than being copied into React
state. Task state in `options.ts` has not yet been migrated.

## Visible changes

Selected rows have a subtle accent background and leading edge. Keyboard focus
outlines the row. The existing background transition respects reduced motion.
Layout, export status meaning, filtering, account isolation and explicit
selection behavior are preserved.

## Tooling

React and React DOM are production dependencies, with matching type packages
and automatic JSX compilation through the existing esbuild/TypeScript setup.
No Vite, CDN, permission increase or CSP relaxation is required. No Stageshow
runtime or simulated cursor is included.

Dependency-direction and circular-dependency scans, incremental impact analysis,
and the strict typed UI lint include TSX. Packaging excludes TSX source along
with TS source. React/Scheduler MIT notices are included in the shipped notices.

## Measured tradeoff

Compared with baseline `6783e02a077b2b1275ffe6500212a619be4589ed` using
the same production build settings:

| Production bundle | Before (bytes) | After (bytes) | Increase |
| --- | ---: | ---: | ---: |
| `dist/ui/options.js` | 1,958,873 | 2,183,165 | 224,292 (~219 KiB) |
| Same file, gzip | 645,200 | 714,464 | 69,264 (~68 KiB) |

The shared tutorial adjustment adds 47 bytes (18 gzip) to Popup; React is not
bundled there. All other generated JS bundles are byte-identical. Gzip is a comparison of script
compression, not a measurement of the complete extension archive. The first
React region pays the framework's initial cost. Startup time and large-list
performance have not been benchmarked.

The original list renderer was 202 lines; the adapter (66) and components (142)
now total 208. The additional contracts are `ConversationRowFacts` and
`ConversationListProps`; the new permission state is local to its control.
The manually maintained DOM cache, row construction and DOM-equality diff are
removed. The benefit is explicit ownership and lifecycle handling, not a
substantial reduction in line count.

## Try it

Run `npm ci` and `npm run build` in this worktree. Load this directory as an
unpacked extension in a separate test Chrome profile, then open its Options.
The shipping manifest is unchanged.

The session's `temp/react-preview/` contains a standalone interactive mock
preview and screenshot. Its banner identifies example data and simulated sync,
export and permissions. Serve it with:

```sh
python3 -m http.server 4178 --bind 127.0.0.1 --directory temp/react-preview
```

The preview is local test evidence, ignored by Git and excluded from release.
Real extension behavior is covered separately by the existing Tier 1 browser
suite. No live-account Tier 2 or pure-visual Tier 3 acceptance is claimed.

## Evaluation and next step

The list is a useful first migration boundary: state-driven rendering replaces
manual node management, and asynchronous control state has an owner. It also
exposes the remaining work: `options.ts` still coordinates mutable task flags
and manually updates most of the page. A full architectural evaluation should
next move one task panel and its explicit task-state transitions into React,
then compare maintenance and performance before expanding to Popup.

## Validation

- Full `npm test` passed: zero-any/typed boundary lint, whole-project type
  checking, the complete unit suite, production build, bundled-font checks and
  all 211 Playwright E2E tests (3.1 minutes for the E2E phase).
- Focused list/tutorial regression: 110 tests passed. Added cases cover focused
  checkbox/details retention during reorder, permission-query lifecycle, and
  same-ID account isolation. The existing title-click tutorial regression caught
  the native-event assumption and passes with the explicit selection bridge.
- `python3 tests/test_impact_analyzer.py`: all 6 tests passed, including TSX
  import resolution and transitive dependency coverage.
- `node build.js --pack`: verified ZIP has no TS/TSX source, the unchanged
  manifest bytes, and the React/Scheduler license notice. The verified archive
  is retained locally as `temp/react-trial.zip`.
- Interactive local mock preview: search, select-all and simulated export
  exercised in Chromium; initial interaction produced no page errors.
- Scenario pool: 20/20; no live scenarios consumed.

Live-account Tier 2 and autonomous visual Tier 3 were not run. The mock preview
is not evidence of either tier.
