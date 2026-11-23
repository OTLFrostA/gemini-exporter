# Target Modular Architecture & Sub-Module Boundary Specification

This document locks in the target modular architecture, sub-module dependency rules, bundle isolation invariants, and five-wave refactoring blueprint for Gemini Exporter. It complements [CURRENT_ARCHITECTURE.md](../../CURRENT_ARCHITECTURE.md) (which describes the active implementation on `main`) by defining the approved target state and invariants for modular evolution.

---

## 1. Non-Negotiable Architectural Foundations (Preserved Baseline)

All modular refactoring must preserve the following five structural guarantees:

1. **Zero-Cast L2 Trust Boundary (`src/l2/runtimeValidation.ts` & `src/l2/closure.ts`)**:
   - External, persisted, and IPC inputs enter as `unknown` and are validated via exhaustive `Check<T>` / `Fields<T>` schemas, reference-closure verification, and private `WeakSet` registration.
   - `L2`, `L3a`, `L3b`, `Application`, and `L4` contain zero `as` type assertions and zero `!` non-null assertions.
2. **Format-Neutral Reading Structure (`src/l3b/ast/ast.ts`)**:
   - `Markdown`, `HTML`, `Typst-PDF`, and `DOCX` renderers consume `DocumentAst` produced by `L3b`. `JSON` remains a direct Domain serialization.
3. **Zero-Payload Invalidation IPC (`notifyDomainChanged`)**:
   - Chrome Runtime IPC never carries full conversation bodies or `FileSystemDirectoryHandle` objects. Writers commit to `L3a` first and broadcast lightweight `accountId` invalidation events.
4. **Metadata-First Attachment Path Planning (`src/l4/packaging/index.ts`)**:
   - Export paths and failure placeholders are planned from trusted Domain metadata before attachment bytes are acquired, allowing folder exports to reuse existing local files and replace documents in place after resource resolution.
5. **Automated CI Architecture Gates (`scripts/check-architecture.cjs` & `tests/arch/*`)**:
   - Every wave must keep `npm test` (including zero-any, architecture DAG checks, unit suites, bundle build, and Playwright E2E) 100% green.

---

## 2. Confirmed Architectural Decisions

### Decision 1: Execution-Context Isolation & Bundle Boundaries (Option A)

- **Options Workbench (`dist/ui/options.js`)**: Retains direct access to `L3a` (IndexedDB) and executes the full five-format export pipeline in-process, because browser Blob downloads and `showDirectoryPicker` authorization require a visible page context.
- **Background Service Worker (`dist/background/background.js`)**: Owns the one-time profile upgrade (`src/migration/upgradeV1.ts`), durable Encrypted Vault outbox processing, Content Script domain ingestion IPC handlers, and background Live Save (`runMarkdownExport`).
- **Popup (`dist/ui/popup.js`) & Options**: Never statically import `src/migration/upgradeV1.ts` or `src/runtime/worker/**`. Extension pages await worker readiness exclusively via the `{ action: 'ensureV2Ready' }` IPC contract.
- **Content Scripts (`dist/content/*.js`)**: Own page observation, MAIN-world hook message bridging, account context binding, and the lightweight floating Badge. Content bundles must never pull in `src/l3a/**`, `src/l4/**`, `src/migration/**`, or full-workbench UI error tables.

### Decision 2: Vertical Consolidation of Encrypted Vault (`src/application/vault/`)

The optional Encrypted Vault is an Application-layer backup workflow, not an `L1` chat source provider or an `L2` core domain entity. Its modules are consolidated under **`src/application/vault/`**:

| Legacy Path | Target Path | Responsibility |
| --- | --- | --- |
| `src/shared/types/cloudSync.ts` | `src/application/vault/contracts.ts` | Wire magic bytes, quota constants, HTTP/local-vault transport contracts |
| `src/l2/cloudPayload.ts` + `src/application/cloud/cloudArchiveCodec.ts` | `src/application/vault/codec/` | Device-independent portable conversation JSON encoding/decoding (delegating validation to `l2/model` decoders) and AEAD+Gzip record sealing |
| `src/l1/cloud/vaultClient.ts` + `src/l1/cloud/localFolderVaultClient.ts` | `src/application/vault/transport/` | Remote v2 Cloud Vault HTTP client and authorized local directory vault client |
| `src/application/cloud/{cloudSyncEngine,vaultPushSync,vaultPullSync,vaultConnection,vaultKeySetup,vaultKeyRotation,vaultShared}.ts` | `src/application/vault/sync/` | Outbox push, cursor pull, key setup/rotation, and connection lifecycle |
| `src/l3a/{vaultStorageService,cloudSyncStore,cloudKeyringStore}.ts` | `src/l3a/` (unchanged) | Passive persistence for the isolated vault IndexedDB |

### Decision 3: Pure L1 Source Acquisition & Parsing (No Direct L2 Persistence Side-Effects)

- `L1` owns provider transport, pagination, passive sniffing, wire decoding, and attachment byte acquisition.
- **`L1` does not call `L2` persistence/admission services (`ingestDetail`, `ingestIndexes`, `ingestDeletedConversation`, `getSourceCooldown`, `extendSourceCooldown`) directly.**
- `AIProvider.fetchConversationDetail(accountId, conversationId, signal, onDiagnostic)` returns `Promise<SourceConversationParseResult>` rather than `Promise<void>`.
- `Application` workflows (`src/application/sync/`, `src/application/export/`, `src/application/conversations/`) own the orchestration of `L1` acquisition -> `L2` admission (`src/l2/admission/`) -> `SourceResourceContext` retention -> `notifyDomainChanged`.

---

## 3. Target Layer & Sub-Module Hierarchy

### 3.1 `src/shared/` — Pure Zero-Business Kernel

- **Allowed contents**:
  - `shared/crypto/**` (generic AEAD, HKDF, bounded Gzip, recovery key formatting, session secret sealing)
  - `shared/diagnostics/diagnostic.ts`
  - `shared/errors/operationError.ts`
  - `shared/resources/resourceResult.ts`
  - `shared/platformHosts.ts` (static platform host/URL registry)
  - `shared/utils/**` (generic concurrency, retry, path/archive sanitization, JSON type guards, devMode, constants)
  - `shared/math/**` (provider-neutral LaTeX/Markdown math normalization)
- **Forbidden in `src/shared/`**:
  - Feature-specific wire protocols (`cloudSync.ts` -> `application/vault/contracts.ts`)
  - Runtime Chrome IPC message envelopes (`geminiRpcCredentials.ts`, `accountContextReply.ts` -> `runtime/ipc/`)
  - Provider-specific parsing heuristics (`RESEARCH_PROMPT_PREFIX_RE`, Gemini/Bard placeholder title patterns, `GM_TEX_*` rules -> `l1/parsers/`)

### 3.2 `src/l2/` — Split into Pure Domain Model (`l2/model`) and Stateful Admission (`l2/admission`)

To eliminate the `l2 <-> l2/content <-> l2/ports` sub-directory cycle and separate pure domain validation from storage I/O:

```text
src/l2/
  content/        # BlockNode, InlineNode, tableLayout, assetReferences (depends only on shared/)
  model/          # Pure synchronous domain types, identity (Account, ConversationKey),
                  # Index/Detail/Coverage value logic, closure.ts, runtimeValidation.ts (0 I/O, depends on l2/content & shared/)
  ports/          # DomainStoragePort & ingestion result contracts (depends only on l2/model)
  admission/      # Stateful domain services: ingestion.ts, accountAdmission.ts, coverageAdmission.ts,
                  # readConversation.ts, sourceCooldown.ts (depends on l2/model & l2/ports)
```

- **Direction rule**: `l2/admission -> l2/ports -> l2/model -> l2/content -> shared`. Zero reverse edges.
- `L1`, `L3a`, `L3b`, `L4`, and `UI` depend only on `l2/model` and `l2/content` (plus `l2/ports` for `L3a` implementation).

### 3.3 `src/l1/` — Acyclic Acquisition, Observation, and Layered Gemini Parser

1. **Breaking `l1/client <-> l1/sniffer`**:
   - Stateless account/session observation decoders and URL/request classifiers move to `src/l1/protocol/<platform>/observation.ts`.
   - Both `l1/client/<platform>` and `l1/sniffer/<platform>` depend one-way on `l1/protocol/<platform>`.
2. **Breaking `l1/client <-> l1/client/<platform>`**:
   - Shared provider contracts and helpers (`aiProvider.ts`, `providerShared.ts`, `providerHost.ts`, `platformAccess.ts`, `tabSourceRunner.ts`, `sourceErrors.ts`, `sourceExecution.ts`) live in `src/l1/client/core/`.
   - Concrete providers (`src/l1/client/{gemini,chatgpt,claude,grok}/`) depend only on `l1/client/core/`.
   - Top-level provider factory/registry (`src/l1/client/registry.ts`) depends on `l1/client/<platform>/` and `l1/client/core/`.
3. **Breaking `l1/parsers/gemini <-> rpc <-> shared` and decomposing 700+ LOC files**:
   - Reorganize `src/l1/parsers/gemini/` into a strict one-way pipeline:
     - `wire/`: JSPB schema, response envelope, request decoding, turn/candidate/attachment extractors (splitting `extractors.ts` and `sourceAttachments.ts` into focused <350 LOC modules).
     - `document/`: Native Gemini structured document tree, text-range validation, and partial slot recovery.
     - `adapt/`: Conversion from Gemini document/Markdown/HTML into `l2/content` blocks, citations, and Gemini-specific title/TeX normalization.
     - `entrypoints` (`parseRpcConversation.ts`, `parseTakeoutConversation.ts`, `parseDomIndex.ts`, `capturedSource.ts`).

### 3.4 `src/l4/` — Decoupled Format Renderers, Shared Bindings, and Focused PDF Compiler

- Move `ResourceBindings` from `src/l4/packaging/resourceBindings.ts` to `src/l4/shared/resourceBindings.ts` so `l4/format/**` has zero imports from `l4/packaging/**`.
- Remove the unused re-export `src/l4/delivery/writers/writerInterface.ts` in favor of `src/l4/shared/writerInterface.ts`.
- Rename `src/l4/format/pdf/typst/` to `src/l4/format/pdf/compiler/` and split `typstSandboxCompiler.ts` (633 LOC) into:
  - `sandboxIframeHost.ts` (iframe lifecycle, origin verification, crash recovery)
  - `sandboxRpcClient.ts` (request correlation, timeouts, cancellation, chunked font mounting)
  - `typstSandboxCompiler.ts` (`IPdfCompiler` implementation)

### 3.5 `src/runtime/` & `src/entrypoints/` — Context-Separated Runtime without Environment Sniffing

Replace the four-way cyclic `runtime/{api,background,capabilities,content}` layout with a strict DAG:

```text
src/runtime/
  ipc/            # Pure message contracts, payload decoders, and lightweight chrome.runtime/tabs clients
                  # (0 imports from worker/, migration/, or l3a/)
  capabilities/   # Chrome permissions, tabs, platform discovery, and FileSystemDirectoryHandle helpers
                  # (depends on runtime/ipc, l1, l2/model, l3a, shared)
  content/        # Content-script runtime: accountContext, messageRouter, liveSaveCoordinator, platform adapters
                  # (depends on runtime/ipc, l1, l2/model, shared)
  worker/         # Service Worker runtime: readiness (sole caller of migration/upgradeV1), IPC handlers, lifecycle
                  # (depends on application, migration, runtime/capabilities, runtime/ipc, l2, l3a)
```

All 12 esbuild bundle roots are consolidated under `src/entrypoints/` (`background.ts`, `popup.ts`, `options.ts`, `content/*.ts`, `hooks/*.ts`, `sandbox/typstCompile.ts`), each acting as the explicit composition root for its execution environment.

### 3.6 `src/ui/` — Lightweight i18n/Theme Split & Workbench State Consolidation

- Split `src/ui/shared/settings.ts` into:
  - `src/ui/shared/i18n.ts` (lightweight `text()`, `englishCount()`, `uiLocale()` safe for Content Badge bundles)
  - `src/ui/shared/errorMessages.ts` (`errorText()` and workbench/popup error copy)
  - `src/ui/shared/theme.ts` (`labelThemeToggle` and `createOptimisticThemeToggle`)
  - `src/ui/shared/settingsObserver.ts` (`readSettings` and `observeSettings`)
- Unify settings defaults in `src/application/settings/schema.ts` (pure function `normalizeGlobalSettings`), shared by both `l3a/settingsStore.ts` and `runtime/ipc/contentSettings.ts`.

---

## 4. Five-Wave Implementation Roadmap

Each wave is executed in an isolated `git worktree` and merged via a dedicated Pull Request after passing `npm test`:

| Wave | Scope | Key Deliverables |
| --- | --- | --- |
| **Wave 1** | **Foundation & Pure Kernel** (`shared`, `l2`, `l4/shared`, `application/settings`) | 1. Split `l2` into `l2/content`, `l2/model`, `l2/ports`, `l2/admission` and eliminate `l2 <-> l2/content` cycle.<br/>2. Move `ResourceBindings` to `l4/shared` and remove dead files (`l4/delivery/writers/writerInterface.ts`, `l1/parsers/gemini/shared/unknownFallback.ts`).<br/>3. Extract pure `application/settings/schema.ts` and deduplicate `contentSettings.ts`.<br/>4. Move parser-only title/TeX heuristics out of `src/shared/utils/`. |
| **Wave 2** | **Runtime DAG & Bundle Isolation** (`runtime`, `entrypoints`) | 1. Replace `runtime/api` context-sniffing modules with `runtime/ipc` contracts/clients and explicit per-entrypoint wiring.<br/>2. Remove static `migration/upgradeV1` dependency from Popup and Options.<br/>3. Relocate Gemini tab-route resolution from `runtime/api/providerHost.ts` into `runtime/capabilities/`.<br/>4. Consolidate bundle entrypoints under `src/entrypoints/`. |
| **Wave 3** | **L1 Purity & Parser De-Cycling** (`l1/protocol`, `l1/client`, `l1/parsers/gemini`, `application`) | 1. Extract stateless account/session observations into `l1/protocol/<platform>/observation.ts` to break `l1/client <-> l1/sniffer`.<br/>2. Introduce `l1/client/core/` to break `l1/client <-> l1/client/<platform>`.<br/>3. Restructure `l1/parsers/gemini/` into `wire -> document -> adapt` and split 700+ LOC files.<br/>4. Change `AIProvider.fetchConversationDetail` to return `SourceConversationParseResult` and move `L2` ingestion calls to `Application`. |
| **Wave 4** | **Encrypted Vault Consolidation & PDF Compiler Split** (`application/vault`, `l4/format/pdf`) | 1. Consolidate `l1/cloud`, `l2/cloudPayload`, `shared/types/cloudSync`, and `application/cloud` into `src/application/vault/`.<br/>2. Split `typstSandboxCompiler.ts` into iframe host, RPC client, and compiler facade under `src/l4/format/pdf/compiler/`. |
| **Wave 5** | **UI Decomposition & Architecture Gate Hardening** (`ui`, `scripts/check-architecture.cjs`) | 1. Split `ui/shared/settings.ts` into `i18n.ts`, `errorMessages.ts`, `theme.ts`, and `settingsObserver.ts`.<br/>2. Extract remaining inline state/cleanup/tour coordination from `ui/options/options.ts`.<br/>3. Upgrade `scripts/check-architecture.cjs` to enforce zero sub-module SCC cycles (Depth-2/Depth-3) and esbuild metafile bundle-exclusion invariants. |
