# TS Batch B closeout

The PDF path passes working data directly to the canonical Gemini normalizer through raw compatibility input types. The #793 runtime adapters are removed. Historical typeless images, non-string content, and unknown roles retain canonical behavior. Local helper types without production consumers are module-private. Legacy domain schemas are unchanged.

## Oxlint baseline

| Snapshot | Files with warnings | Warnings | Errors |
| --- | ---: | ---: | ---: |
| Batch B before (provided baseline) | 109 | 4249 | 0 |
| Closeout before (`cd47583`, after #792–#794) | 106 | 3803 | 0 |
| Batch B after | 104 | 3743 | 0 |

Counts refer to files emitting warnings. Captured using the full type-aware `npm run lint -- --format json`. The machine-readable per-file baseline is in `batch-b-oxlint-baseline.json`. No file increased relative to the closeout starting commit; this includes all unrelated first-party files.

`mediaIndex.ts`, `prepareItem.ts`, and `liveSaveCoordinator.ts` each have 0 warnings.

## Top 15 warning files

| File | Warnings |
| --- | ---: |
| `src/core/engine/export/exportOrchestrator.ts` | 582 |
| `src/core/engine/export/batchWorker.ts` | 413 |
| `src/core/export/typst/mitex/vendor/mitex_wasm_bg.js` | 132 |
| `src/core/api/client/credentialManager.ts` | 111 |
| `src/core/storage/storageService.ts` | 108 |
| `src/ui/views/listView.ts` | 105 |
| `src/background/liveSaveHandler.ts` | 98 |
| `src/content/assetFetcher.ts` | 92 |
| `src/core/engine/export/sessionRecovery.ts` | 87 |
| `src/ui/state/conversationsStore.ts` | 85 |
| `src/content/messageBridge.ts` | 78 |
| `src/content/contentContext.ts` | 76 |
| `src/content/bootstrap.ts` | 74 |
| `src/core/export/canonical/markdown/mdastToCanonical.ts` | 74 |
| `src/core/api/parser/parseDetail.ts` | 67 |

## Validation

`npm run lint`, `npm run type-check`, and the full `npm test` all PASS locally (including 44 Playwright tests). Focused regressions cover both message and turn PDF inputs, input immutability, and direct canonical inputs with missing metadata and historical URL/name aliases. The scenario pool is 20/20.

## Deferred debt

The nonblocking architecture debt from #792 and #794 remains deferred: Takeout contract consolidation and LiveSave transport compatibility. No changes to batchWorker.ts, exportOrchestrator.ts, liveSaveHandler.ts, assetFetcher.ts, Domain / Storage V2, or OpenAI starter code. Batch B ends here; the next phase requires separate planning.
