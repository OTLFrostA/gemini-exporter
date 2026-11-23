# Gemini Exporter — Architecture Specification

This document is the authoritative architectural specification for Gemini Exporter on `main`. It defines the enforced layer DAG, trust boundaries, multi-platform symmetry, export and Encrypted Vault engines, runtime IPC/concurrency contracts, UI state architecture, and CI governance gates.

For a high-level summary and platform support matrix, see [CURRENT_ARCHITECTURE.md](../../CURRENT_ARCHITECTURE.md). For the directory-to-owner map, see [src/README.md](../../src/README.md).

---

## 1. Layer & Sub-Module Dependency DAG

All production modules under `src/` are partitioned into 11 strict architectural layers with **zero file cycles, zero cross-layer cycles, and zero depth-2 sub-module cycles** (enforced automatically by `scripts/check-architecture.cjs`):

```text
entrypoints ──► ui, runtime
ui          ──► application, runtime, l2, shared
runtime     ──► application, l1, l2, l3a, migration, shared
application ──► l1 (port/registry only), l2, l3a, l3b, l4, shared
migration   ──► l2, l3a, shared
l4          ──► l3b, l2, shared
l3b         ──► l2, shared
l3a         ──► l2, shared
l1          ──► l2, shared
l2          ──► shared
shared      ──► (none)
```

### Key Boundary Invariants
1. **`L2` never imports `L3a`**: Domain admission modules (`accountAdmission.ts`, `ingestion.ts`, `coverageAdmission.ts`, `readConversation.ts`, `sourceCooldown.ts`) interact with storage exclusively through the `DomainStoragePort` (`src/l2/storagePort.ts`), keeping `L2` pure and independently testable.
2. **`L1` never writes directly to `L2` persistence**: `AIProvider` implementations under `src/l1/client/` depend only on the `ProviderHost` port (`src/l1/client/providerHost.ts`) injected by `runtime/api/providerHost.ts`. `L1` owns transport, wire decoding, pagination, and resource byte acquisition; `Application` and `Runtime` own admission and side-effects.
3. **`Application` never imports concrete platform clients**: `src/application/` interacts with platforms through `taskProvider` / `aiProvider` abstractions, never directly importing `src/l1/client/{gemini,chatgpt,claude,grok}/`.
4. **Execution-context & bundle isolation**:
   - **Options (`dist/ui/options.js`)**: Direct `L3a` IndexedDB access and in-process 5-format export execution (required for Blob downloads and `showDirectoryPicker`).
   - **Background Service Worker (`dist/background/background.js`)**: Sole caller of `src/migration/upgradeV1.ts` (via `runtime/background/readiness.ts`), durable Encrypted Vault outbox processing, Content Script IPC ingestion, and background Live Save (`runMarkdownExport`).
   - **Popup (`dist/ui/popup.js`) & Options**: Never statically import `migration/upgradeV1.ts`; they await worker readiness via `{ action: 'ensureV2Ready' }`.
   - **Content Scripts (`dist/content/*.js`)**: Own page observation, MAIN-world hook message bridging, account context binding, and the floating Badge; never pull in `l3a/`, `l4/`, `migration/`, or full-workbench error tables.

---

## 2. Domain Trust Boundary & Account Identity (`L2`)

### 2.1 Zero-Cast Trust Boundary
- All external, persisted, and IPC inputs enter `src/l2/runtimeValidation.ts` as `unknown` and pass exhaustive `Check<T>` / `Fields<T>` runtime validators, `src/l2/closure.ts` reference-closure checks, and private `WeakSet` registration.
- `L2`, `L3a`, `L3b`, `Application`, `L4`, `l1/parsers/gemini/`, and `runtime/background/domainStorageHandler.ts` contain **zero `any`, zero `as` type assertions, and zero `!` non-null assertions** (enforced by `scripts/check-zero-any.cjs`, `scripts/check-domain-trust-lint.cjs`, and the TypeScript compiler-based `tests/arch/domain-trust-boundary.test.ts` covering both `.ts` and `.tsx`).

### 2.2 Account Registry & `ConversationKey`
- Every conversation is uniquely identified by `ConversationKey = { accountId: string, conversationId: string }`, where `accountId` is a device-local Registry UUID (`src/l2/accountRegistry.ts`), never a transient URL slot (`/u/0/`) or email address.
- Deletions require an identified (non-`default`) account, a source-verified receipt, and atomic removal of Index, Detail, and ExportRecord for the exact `ConversationKey` without affecting other accounts.
- `Detail` quality (`complete` / `partial` / `unknown`) is computed uniformly via `contentQuality()` (`src/l1/parsers/qualityEvidence.ts`). Complete snapshots are never overwritten by inferior incomplete captures.

---

## 3. Four-Platform Symmetry (`L1` & `Runtime`)

All four supported platforms (`gemini`, `chatgpt`, `grok`, `claude`) share one declarative metadata registry:

- **Single Source of Truth (`src/shared/platformHosts.ts`)**: `PLATFORM_HOSTS` declares `name`, `signInUrl`, `conversationUrlPrefix`, `pages`, `attachments`, `contentScripts`, `conversationIdFormat` (`'hex' | 'uuid'`), and `supportsZipImport`, alongside `isValidPlatformConversationId(platform, value)`. `platformInjection.ts` and `domainStorageHandler.ts` consume this table directly with no duplicated platform lists.
- **Sniffer vs. DOM Observer Separation**:
  - `src/l1/sniffer/{gemini,chatgpt,claude,grok}/` owns pure wire/event observation and serialized `window.postMessage` bridging.
  - Page DOM `MutationObserver`s (such as Grok response observation and Claude sidebar observation) live in `src/runtime/content/{grokContent,claudeContent}.ts`, keeping `L1` decoupled from UI/DOM element IDs.
- **Optional Permissions**: Each platform uses optional host permissions in `manifest.json` (`src/runtime/capabilities/platformAuthorization.ts` & `platformInjection.ts`).

---

## 4. Storage (`L3a`), Document AST (`L3b`), and 5-Format Export (`L4`)

### 4.1 Passive Storage (`L3a`)
- `src/l3a/` implements typed passive IndexedDB persistence (`accounts`, `indexes`, `details`, `exportRecords`, `coverage`, plus the isolated Encrypted Vault store) and `FileSystemDirectoryHandle` storage.
- `L3a` never makes freshness decisions, never merges source payloads, and never reads or writes v1 migration markers.

### 4.2 Format-Neutral Document AST (`L3b`)
- `src/l3b/compose/` transforms trusted `L2` Domain conversations into a format-neutral `DocumentAst` (`src/l3b/ast/ast.ts`) containing logical turns, headings, paragraphs, code blocks, math, tables, citations, reasoning blocks, and asset references.
- `Markdown`, `HTML`, `Typst-PDF`, and `DOCX` consume `DocumentAst`; `JSON` (`src/l4/format/json/serializeDomainJson.ts`) serializes trusted `L2` Domain directly.

### 4.3 Metadata-First Export Pipeline (`Application/Export` + `L4`)
- **Path Planning Before Bytes (`src/l4/packaging/`)**: Output paths and failure placeholders are planned from trusted Domain metadata before acquiring attachment bytes. Folder exports reuse existing local attachment files by path without re-downloading.
- **Linked Folder Delivery & `retireChain`**: For `folderWriter` exports, documents are written first and updated in place once attachments resolve. Zero-attachment items finalize cleanly without orphaning `retireChain` or blocking on `downstreamSemaphore`.
- **Bounded Concurrency & Memory Release**:
  - Secondary `needsResourceRefresh` detail fetches route through `detailPrefetchSemaphore`.
  - `exportPipeline.ts` clears `pendingSlots` immediately after extraction and nulls each `pending[index]` entry after `renderGroup()` so raw `Uint8Array` attachment buffers are eligible for GC before `ZipWriter` runs.
- **Typst-PDF Sandbox (`src/l4/format/pdf/typst/`)**: Compiles in an isolated iframe sandbox with bundled offline fonts, automatic WASM fault recovery, and deterministic sandbox rotation every 32 compiles.
- **DOCX (`src/l4/format/docx/`)**: Local Word `.docx` generation from `DocumentAst` with embedded raster images, tables, code blocks, and math fallback.

---

## 5. Encrypted Vault (`src/application/vault/`)

The optional Encrypted Vault is a self-contained Application workflow supporting both an authorized local folder (`localFolderVaultClient.ts`) and a user-configured v2 Cloud Vault server (`vaultClient.ts`):

- **Zero-Knowledge Cryptography (`src/shared/crypto/`)**: GEK1 Crockford Base32 256-bit recovery key -> HKDF non-extractable subkeys (`payloadKey` + blind-ID key) -> bounded Gzip + `AES-256-GCM` (`GEE1` envelope) with AAD binding `(ownerSubject, blindRecordId, revision)`. Decryption uses a zero-copy ciphertext `Uint8Array` view when backed by `ArrayBuffer`.
- **Resilient Push & Key Rotation (`vaultPushSync.ts`, `vaultKeyRotation.ts`)**:
  - Single `encodePortableCloudConversation` serialization per push (reused by `sealCloudConversation`).
  - Server HTTP 413 (`CLOUD_RECORD_TOO_LARGE`) is classified identically to client-side size limits (`oversizedBytes`) without stalling outbox flushes or bricking cloud key rotation.
  - Failed retries are tracked by `retriedEnqueueIds` (`entry.enqueueId`) rather than breaking the loop or blocking same-conversation re-enqueues arriving during an active PUT.
- **Bounded Pull (`vaultPullSync.ts`)**: Downloads and commits remote records in slices of 10 to bound peak decoded AST memory.
- **Cross-Context Locking**: Coordinates via `navigator.locks` (`withVaultOperation` wrapping multi-step operations such as `setIncludeDetail`), with an in-process Promise-chain fallback in `localFolderVaultClient.ts` when Web Locks are unavailable.

---

## 6. Runtime IPC Security, Concurrency & UI State

### 6.1 IPC Security & Liveness
- **Extension-Origin Sender Validation**: `cloudSyncHandler.ts` and background tab-management routes (`openGeminiPage`, `reloadGeminiTab`) verify `sender.id === chrome.runtime.id` and extension-origin `sender.url`, rejecting web content-script callers while permitting extension pages (Options/Popup tabs).
- **Bounded Tab Probes**: `preparePlatformTab` and `providerHost` wrap `chrome.tabs.sendMessage({ action: 'getAccountContext' })` in a 3000ms timeout and validate replies via `readAccountContextReply`.

### 6.2 Zero-Payload Invalidation & Coalescing
- Writers commit to `L3a` first and emit lightweight `notifyDomainChanged(accountId)` broadcasts (no conversation bodies or directory handles over IPC).
- `batchAdmitImports.ts` avoids duplicate tail notifications when `total % sliceSize === 0`.
- Options (`src/ui/options/options.ts`) coalesces incoming `domainChanged` events (16ms idle / 150ms while scanning or busy) and invokes `cloudPanel.onDomainChanged` inside the coalesced flush loop.

### 6.3 Options UI State Ownership
- **Dedicated Settings Lock**: `settingsAndDeliveryController.ts` uses a serialized `runSettingsWrite` lock with field-level rollback instead of overloading `perform('cleanup', ...)`, preserving task feedback and avoiding full IndexedDB refreshes on toggle clicks.
- **Controller-Owned Scan State**: `workbenchScanController.ts` owns `evidence`, `takeoutCount`, `slow`, `connectionError`, and `advanceTutorialScan`, exposing `getState()`, `clearConnectionError()`, `clearImportBannerState()`, and `resetAccountState()`.
- **Explicit Props over DOM-as-State**: `listView.ts` receives `disabled` and `guidedSelection` (`TourGuide.isGuidedSelection()`) explicitly instead of reading `document.body.dataset.*` (while `workbenchView.ts` retains `data-foreground-busy` as a write-only observable attribute for E2E harnesses).
- **Account Switch Hygiene**: Both explicit and implicit account switches call `resetAccountEphemeralState()`, and `cloudVaultController.ts` guards `silentAutoSync()` with `!mounted || externalBusy || internalBusy`.

---

## 7. Automated Architecture Gates & Testing

| Gate / Command | What It Enforces |
| :--- | :--- |
| `node scripts/check-architecture.cjs` | 11-layer DAG allowlist, no `application -> l1/client/<platform>`, 0 file/layer/submodule cycles across `src/`. |
| `node scripts/check-zero-any.cjs` | Zero explicit `any` across all `src/**/*.{ts,tsx}` + 18 scoped non-`src/` files, plus type-aware unsafe-any lint (`check-domain-trust-lint.cjs`). |
| `tests/arch/*` | Compiler-based zero-cast/zero-`!` trust boundary (`.ts` + `.tsx`), semantic layer rules, storage write guards, and circular dependency checks. |
| `npm run test:v2:unit-isolation` | Strict runtime `Module._compile` guard (`v2UnitRealModuleGuard.cjs`) verifying all 10 module owners pass with frozen v2 contract mocks. |
| `npm run test:changed` | Dependency-aware incremental runner: runs `check-architecture.cjs` + `check-zero-any.cjs` + `tsc --noEmit` + affected unit suites + `build.js` + feature-mapped Playwright E2E specs. |
| `npm test` | Full CI release gate: zero-any, architecture DAG, `tsc --noEmit`, full unit suite (`--skip-typecheck`), production bundle build, bundled font verification, and full Playwright E2E suite. |

See [v2-unit-isolation.md](../v2-unit-isolation.md), [tier2-platform-plugins.md](../tier2-platform-plugins.md), and [tier3-exploration-checklist.md](../tier3-exploration-checklist.md) for testing protocols.
