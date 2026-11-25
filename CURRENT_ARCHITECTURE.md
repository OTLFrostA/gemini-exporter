# Current Architecture

This file summarizes **the active implementation on `main`**. For the complete architectural specification (layer DAG, trust boundaries, export/vault internals, IPC/concurrency contracts, and CI gates), see [docs/architecture/architecture.md](docs/architecture/architecture.md). For the directory-to-owner map, see [src/README.md](src/README.md).

## Platform Status

| Platform | Current Source Integration | Release / Acceptance Scope & Known Limits |
| :--- | :--- | :--- |
| **Gemini** | Native RPC/sniffer parsing, account-aware sync, Takeout ZIP import, Live Save, 5-format local export | Primary Chrome Web Store product. |
| **ChatGPT** | Opt-in account/workspace-aware source adapters and official export-ZIP import | Experimental; requires separate authenticated validation. |
| **Claude** | Opt-in organization-aware source adapters, selected-branch/tool/attachment handling | Experimental; exports selected branch only, sidebar observation does not establish full list coverage, and incomplete/unrecognized tools remain `partial`/`unknown`. |
| **Grok** | Opt-in source adapters, Loominary-adapted response/citation normalizer, generated-image & file handling | Experimental; DOM images enrich their exact response container only, multi-branch without authoritative selection reports `partial`. |

All four platforms use separate optional host permissions in [manifest.json](manifest.json) and share one declarative metadata table in [src/shared/platformHosts.ts](src/shared/platformHosts.ts). `src/l1/client/`, `src/l1/sniffer/`, and `src/l1/parsers/` contain concrete provider implementations; runtime and UI access is strictly permission- and account-scoped.

## Core Data Flow & Boundaries

```text
provider page, native RPC, or imported archive
   -> L1 capture / transport / parser / resource acquisition (via ProviderHost port)
   -> L2 Account + ConversationKey + Index/Detail Domain admission (zero-cast trust boundary)
   -> L3a passive IndexedDB / directory-handle persistence (via DomainStoragePort)
   -> Application sync / import / export / Encrypted Vault workflows
   -> L3b format-neutral DocumentAst
   -> L4 Markdown / HTML / Typst-PDF / DOCX rendering, packaging & delivery (JSON serializes L2 directly)
```

- **L1 (`src/l1/`)**: Validates external wire input, decodes provider payloads, and acquires temporary resource bytes. Purely upstream of Domain — never writes directly to `L2` persistence and never holds page DOM `MutationObserver`s (which live in `src/runtime/content/`).
- **L2 (`src/l2/`)**: Owns `Account` UUID identity, `ConversationKey`, zero-cast runtime validation, reference closure, Index/Detail merging, quality rules, and Coverage admission. Never imports `L3a`.
- **L3a (`src/l3a/`)**: Passive typed IndexedDB and directory-handle persistence only. Never decides freshness or reads v1 migration markers.
- **L3b (`src/l3b/`)**: Composes format-neutral `DocumentAst` from trusted `L2` Domain.
- **L4 (`src/l4/`)**: Plans output paths from metadata first, renders Markdown/HTML/JSON/Typst-PDF/DOCX, packages ZIPs, and delivers files to browser downloads or local folders.
- **Application (`src/application/`)**: Orchestrates sync, batch import, 5-format export, local cleanup, settings normalization, and the optional Encrypted Vault (`src/application/vault/`). Never imports concrete `l1/client/<platform>/` modules.
- **Runtime & UI (`src/runtime/`, `src/ui/`)**: Own extension-origin Chrome IPC, sender validation, permissions, content script bootstrapping, Options/Popup/Badge views, and guided onboarding.
- **Migration (`src/migration/upgradeV1.ts`)**: Independent one-time, nondestructive v1/v1.7 profile upgrade called solely by `src/runtime/background/readiness.ts`.

## Privacy & Encrypted Vault

Exports run entirely on the user's device with zero developer telemetry. Optional Encrypted Vault (`src/application/vault/`) syncs client-side `AES-256-GCM` (`GEE1`) encrypted conversation records via `src/application/vault/transport/` to an authorized local folder or a user-configured v2 Cloud Vault server. Catalog metadata syncs by default; local Detail bodies are opt-in and original binary attachments are excluded.

## Verification & Governance

- **`npm test`**: Offline release gate covering zero-any lint, `scripts/check-architecture.cjs` (0 layer violations, 0 file/layer/submodule cycles), `tsc --noEmit`, batched Sociable Core unit/integration + `fast-check` fuzzing + `tests/arch/*` suites, production bundle build, bundled font checks, and worker-reused high-fidelity Playwright E2E.
- **`npm run test:harness`**: Offline self-test suite for Python/Tier 2/Tier 3 test tooling, separated from the product `npm test` gate.
- **`npm run test:changed`**: Dependency-aware incremental gate running architecture/zero-any checks, type-check, affected unit tests, build, and feature-mapped Playwright E2E specs.
- **`npm run test:v2:unit-isolation`**: Enforces DAG-aware Sociable Core module isolation across all 10 owners ([docs/v2-unit-isolation.md](docs/v2-unit-isolation.md)).
- **Tier 2 & Tier 3**: Live authenticated browser validation ([docs/tier2-platform-plugins.md](docs/tier2-platform-plugins.md)) and pure-visual autonomous QA ([docs/tier3-exploration-checklist.md](docs/tier3-exploration-checklist.md)).
