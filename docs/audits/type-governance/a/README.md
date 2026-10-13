# Type governance PR1: A1–A14

Baseline: main `b83f3ce94a64536ea55991b14b3ac8878293bd3f`.

A1 uses actual function types for eleven duplicated declarations. `checkIsUpdated` deliberately remains unchanged: exportOrchestrator's raw `curIds[nid]` fallback can still be a primitive `StoredValue`, which cannot be statically proven to satisfy `ExportActivityRecord`. Resolving that input boundary is excluded from this static cleanup.

A2/A3 use existing Window declarations without changing mirror timing or global exports. A4 removes the pending-assets assertion and aligns IListView with the existing implementation's `Partial<ExportRecord>` input via `typeof`; the task incorrectly assumed the intermediary interface already accepted partial records. A5/A6 remove assertions on declared dependencies and static writer properties, retaining every fallback branch. A7 uses actual comparator parameter types. A8/A9 use the existing FailedChat contract (including existing view/test providers). A10 reuses OptionsExportOptions.loadStore. A11 infers the stored Conversation item. A12 uses unknown[] because completion only reads array length. A13 changes only the storage-key enumeration's value type. A14 removes response index signatures; all production callers pass structurally compatible Response objects.

`lint-before.json.gz` and `lint-after.json.gz` are independent full oxlint JSON snapshots (gzip only saves repository space). `lint-comparison.json` contains counts for every rule/file/severity, including unchanged warnings. Commands: `npm run lint -- --format json`; no lint configuration or exclusions changed.

Validation: type-check passes. Esbuild transformation of every changed TypeScript file produces byte-identical ES2022 JavaScript to baseline; type-only imports are erased. Full npm test/CI results are recorded in the PR. No parser, sorting behavior, network interception or Takeout logic changed; this is a static-only task.
