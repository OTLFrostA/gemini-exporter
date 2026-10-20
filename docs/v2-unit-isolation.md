# dev/v2 — final module-unit isolation

**Target:** `dev/v2`. Unit ownership is about which production implementation is
executed, **not** about which public TypeScript definitions are referenced.

## Invariant

1. A module unit test executes real code belonging to exactly one owner:
   L1, L2, L3a, L3b, L4, Application, Runtime, UI, Migration or Shared.
2. Whenever it needs another module's service, it constructs a **test double**
   implementing the **actual frozen v2 exported TypeScript signature** (using
   `import type`, `typeof import(...)`, and/or `satisfies`). Never invent a
   backward-compatible v1 production facade or execute an adjacent module merely
   to produce a fixture. Shared pure primitives are allowed as the common base.
3. Mock callbacks only supply scripted facts and capture decisions; they must not
   reimplement another module's database transactions, merge policies, AST
   algorithms, formatters or browser routing.
4. A test that intentionally exercises two or more real modules is an
   **integration test**, retained unmodified and run under integration/global
   regression discovery. Never delete a scenario just to get a green unit gate.
5. There is no assertion that a retired v1 interface must be absent.

## What changed

- **L2:** Five old `l2-tier1.json` cases execute real L3a/IndexedDB and
  sometimes Runtime; they are explicitly preserved under `integrationSuites`.
  `l2-v2-unit-mocked.test.ts` tests real L2 Index/Detail/Account/Coverage
  decisions against typed frozen v2 L3a and Runtime mock ports. No storage
  implementation or transaction emulator is involved.
- **L3b:** `asset-presentation.test.ts` exercises L2 validation, L3b
  composition and L4 renderers, so it moves from the unit list to preserved
  integration coverage. The dedicated runner reads the canonical owner manifest.
- **Migration:** New `migration-v2-mocked.test.ts` runs real one-time upgrade
  logic with type-constrained mocked L2 validators and L3a writes. Native
  fake-indexeddb is only a browser/legacy-read primitive; no L3a implementation
  is loaded. The original `upgrade_v1.test.cjs` remains a real cross-module
  regression and is NOT reclassified as an isolated unit.
- **All owners:** `v2UnitRealModuleGuard.cjs` rejects compilation of any
  other real production module during the strict unit run, including transitive
  imports through test helpers. A test-provided mock never compiles that code.
  The browser-bundled L3a suite separately checks esbuild's module graph.
  Existing L1/L3a/L3b/L4/Application/Runtime/UI test doubles remain in place.
- **Shared:** the dedicated self-contained retry/backoff tests use only
  `src/shared`.

## Independent acceptance

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:v2:unit-ports       # types all owner mocks against current TypeScript contracts
npm run test:v2:unit-isolation   # all ten module owners, hard-fail on real external execution
node scripts/test-v2-unit-isolation.cjs l2 migration  # optional targeted run
```

The new `V2 Module Unit Isolation` GitHub Actions workflow is an independent
acceptance gate targeting PRs into `dev/v2`. Its result must be observed; the
existence of the workflow or of green historical checks is not a passing-test
claim.

## Existing regression gates are preserved

- `npm run test:unit` / `tests/run_tests.py` is the *historical combined*
  Tier-1 regression discovery, and still includes mixed/legacy cross-module
  behavior. It must **not** be cited as proof that every historical file is an
  isolated unit.
- `node scripts/test-l2.cjs` (without `--unit-only`) and
  `node scripts/test-l3.cjs` preserve real integration scenarios.
  L1 `integration` and L4 `--integration` lists are independently runnable.
- Whole-repository TypeScript, Build, legacy regression, and browser E2E checks
  remain separate; their results are not waived or silently skipped by this PR.
