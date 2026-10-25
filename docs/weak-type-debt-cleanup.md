# Weak type debt cleanup

Baseline: `838036cc`. This cleanup repairs internal type loss and removes dead
indirection. It does not add browser-message validators. The earlier Content
validation proposal was reverted before this change.

## Upstream repairs

1. `moduleOverrides` erased module identity into `Map<string, unknown>` and let
   callers assert arbitrary `T`. Repository call-site inspection found only JSZip
   injection in actual tests; Gemini Protocol/Utils override readers had no setters.
   Delete the container, its three unconstrained generic functions, and four dead
   reader wrappers. Production imports now retain their exact module contracts.
   JSZip has a concrete constructor slot at its owning writer with two typed
   setter/getter functions, preserving the production-mode injection guard.
   Test fakes must implement the actual ZIP writer port; throwing fake methods
   explicitly return `Promise<never>`. Four negative type cases reject arbitrary
   module names, incomplete constructors, wrong output and caller-selected types.
2. Platform identity came from an object, became `string[]` through `Object.keys`,
   and was asserted back twice. Export a literal platform tuple and check the host
   map against its exact key set with `satisfies`. UI rows retain their platform,
   input and status together instead of two maps plus non-null lookups. Capture a
   narrowed tab URL locally and use the tab ID directly inside a narrowing branch.
3. Account and ingestion request helpers accepted operation names independently of
   `Record<string, unknown>` parameters. Replace these with discriminated requests
   derived from the existing Account and ingestion contracts. Response `unknown`
   remains at the actual IPC boundary with the existing decoders.

The two forged generic reads and two lost platform-key relationships are removed;
two request helpers now preserve operation/payload relationships. Four casts and
four non-null assertions disappear. No new unchecked assertion, runtime decoder,
exception approval or broad boundary type is introduced.

ZIP byte sizing uses the existing `WriteFileContent` union directly, removing an
artificial optional-size intersection and its impossible length branch. Unused
`file()` output is `void`; typed optional callbacks no longer need runtime function
checks. External JSZip loading retains its existing boundary behavior.

## Complexity

Production diff: +68/-116 lines (net -48). Delete one module and seven
functions; add two concrete ZIP test-seam functions. Replace one generic map with
one typed optional constructor and two UI maps with a row array. Add two private
request union aliases and export the existing ZIP constructor contract; remove
the synthetic ZIP content alias. No new runtime validation branches are added.

## Comparable AST inventory

Skill scripts use `--roots src,tests,scripts` and the explicit TypeScript 5.9.3
Compiler API sidecar. Syntax hits are inventory, not confirmed defects. The source
columns show the production subset; repository columns also include test fixtures
and scripts. Zero explicit production `any` hits does not imply zero implicit
`any` flows.

| Category | Source before | Source after | All before | All after |
| --- | ---: | ---: | ---: | ---: |
| any | 0 | 0 | 1129 | 1129 |
| unknown | 531 | 525 | 1345 | 1338 |
| object | 7 | 7 | 20 | 20 |
| broad-record | 124 | 122 | 351 | 349 |
| as-assertion | 49 | 45 | 1030 | 1024 |
| angle-assertion | 0 | 0 | 0 | 0 |
| as-const | 23 | 24 | 367 | 368 |
| non-null | 36 | 32 | 423 | 419 |
| generic-unconstrained | 14 | 11 | 49 | 46 |
| generic-constrained | 22 | 22 | 43 | 43 |
| runtime-typeof | 840 | 836 | 1051 | 1047 |
| type-query-typeof | 41 | 44 | 224 | 228 |

`audit-type-flow.cjs --roots src --project tsconfig.json` reports generic assertion
candidates 4→2 and parameter-widening candidates 234→228. It retains one pre-existing
TS5 compatibility diagnostic in `credStorage.ts`, so these are heuristic leads,
not native TS7 proof or an automatically approved baseline. Native TS7 type checking
and the repository's Oxlint gates are the authoritative executable checks.

The unsafe-flow gate now also includes the six cleaned platform/request files.
L1 Gemini and L4 already have directory-wide gates; deleting the old module removes
its obsolete entry from the explicit zero-any file list without reducing coverage.

## Remaining scope

Untrusted provider, IDB and IPC inputs still legitimately use `unknown`. Remaining
candidate debt includes UI generic DOM assertions, Background ingestion casts,
legacy migration and directory-handle capabilities, plus extensive test/script
fixtures. None is silently approved as an exception or claimed fixed here.

Provider decoding algorithms, interception, pagination and Takeout semantics are
unchanged; only unused module override lookup was removed from their import path.
Tier 2 and Tier 3 live runs are not part of this cleanup's verification.

## Verification

- Native `npm run type-check` and `node scripts/check-zero-any.cjs`: passed.
- Expanded `node scripts/check-domain-trust-lint.cjs`: passed.
- Runtime/platform/packaging tests: 69 passed; writer/export tests: 37 passed;
  deletion/cycle architecture tests: 4 passed.
- Full `npm test`: passed outside the macOS sandbox, including 369 unit test files,
  build, bundled-font gate and Playwright (168 passed, 1 existing skip).
- `npm run lint` still reports debt outside this scope; it is not a zero-warning
  repository-wide claim.
- `git diff --check`: passed. `manifest.json` is unchanged.
