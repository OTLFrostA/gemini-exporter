# Module unit-test isolation (Sociable Core Testing)

Current source owners are L1, L2, L3a, L3b, L4, Application, Runtime, UI, Migration and Shared. We follow **Sociable Core Testing** along the v2 architecture DAG:

- Pure downstream core modules (`Shared`, `L2`, `L3b`, and in-memory `L3a` fakes/helpers where appropriate) may be imported directly by upstream owners when testing real behavior, avoiding brittle hand-rolled clones of L2 validators or AST composers.
- External browser/network/storage I/O boundaries (`chrome.*`, `fetch`, remote providers, real IndexedDB) remain mocked at the boundary with test doubles conforming to the **current exported TypeScript contract** (`import type`, `typeof import(...)`, `satisfies`).

## Rules

1. Import the real implementation of the owner being tested (and permitted pure core collaborators along the v2 DAG). Replace calls across I/O or upward/lateral owner boundaries with typed test doubles conforming to the **current exported TypeScript contract**, not a newly invented backward-compatible Facade.
2. Never duplicate L2 validation logic (`restoreDomainDetail`, `normalizeGlobalSettings`, `assertDomainClosure`) inside test mocks — import the real L2/Shared helper so schema drift fails immediately.
3. `tests/helpers/v2UnitRealModuleGuard.cjs` enforces the DAG-aware sociable allowlist (`src/shared/*`, plus DAG-permitted pure core modules per owner) against unintended cross-layer coupling. A green ordinary `npm run test:unit` is **not** evidence of module isolation.
4. A test of released v1/v1.7 migration is a real migration regression, not permission to restore a v1 production API. Preserve `tests/upgrade_v1.test.cjs` and its Tier 1 wrapper.

## Commands

```sh
npm run test:v2:unit-ports
npm run test:v2:unit-isolation
node scripts/test-v2-unit-isolation.cjs l2 migration
npm run test:harness
npm test
```

The port gate checks mock and owner interface types. The isolation gate checks the compiled real-module boundary across all 10 owners. `npm run test:harness` runs the Python/Tier 2/Tier 3 test-tooling self-tests separately from the product `npm test` gate. `npm test` additionally checks TypeScript, the mixed unit/integration + `fast-check` fuzzing regressions, production bundling, and Playwright browser behavior. None of these replaces authenticated live Tier 2.

See [tests/README.md](../tests/README.md) for test entrypoints and anti-bloat governance rules, and [source architecture](../src/README.md) for ownership.
