# 🏗️ Gemini Exporter — Source Code Architecture & Directory Guide

This document describes the modern directory layout, subsystem boundaries, build artifacts, and development invariants of the `src/` codebase.

For full architectural diagrams, AST logical mapping matrix, sequence diagrams, and testing specifications, refer to [docs/architecture.md](../docs/architecture.md).

---

## 🏛️ Comprehensive Subsystem Layout

Gemini Exporter enforces a strict 4-tier modular architecture across Chrome MV3 boundaries and domain responsibilities, implemented in strict TypeScript:

```
src/
  background/                  Extension Service Worker Subsystem (MV3 Background)
    background.ts              Central message routing, lifecycle initialization, keepalive orchestration
    lifecycle.ts               Install workbench opening, feedback URL, session storage access level
    keepAlive.ts               Heartbeat ping mechanism for lengthy batch export & deep scan tasks
    abortManager.ts            Multi-account slot abort flags persisted in chrome.storage.session
    batchFetcher.ts            Background batchexecute RPC proxy and tab message failover
    liveSaveHandler.ts         Background FileSystemDirectoryHandle disk save executor
    tabAction.ts               Dynamic active icon color/gray status listener

  content/                     Injected Gemini Content Script Subsystem
    content.ts                 ISOLATED world entrypoint & subsystem coordinator (bundled to dist/content/content.js)
    content.css                Floating badge styling & live save UI animation
    hookCredentials.ts         MAIN world network interceptor & credential sniffer (bundled to dist/content/hook.js)
    accountSniffer.ts          Real Google profile sniffer (email, name, gaiaId) from DOM avatar & WIZ data
    messageBridge.ts           Cross-world window.postMessage bridge (MAIN -> ISOLATED)
    liveSaveObserver.ts        Gemini generation completion & DOM mutation debounced observer
    liveSaveCoordinator.ts     Real-time live auto-save coordinator (RPC/DOM -> IndexedDB & Disk)
    syncEngine.ts              Incremental & deep history scan coordinator
    domScraper.ts              DOM fallback scraper when RPC payloads are unavailable
    badgeView.ts               Floating sync & live save feedback badge in Gemini web UI
    assetFetcher.ts            Media, images, and blob streaming fetcher
    bootstrap.ts               Page token & initial credential bootstrap
    cleanupRegistry.ts         Hot reload / re-injection listener cleanup registry
    contentContext.ts          Cancellation tokens, timer registries, dev mode state
    messageRouter.ts           Message routing between background/options and content script
    pageObserver.ts            SPA URL change and sidebar DOM mutation observer

  core/                        Pure Domain Logic & Engine (Strictly Decoupled from DOM)
    provider/                  Universal AI Provider Abstraction Layer
      aiProvider.ts            Universal AI provider interface, capabilities & data contract
      providerRegistry.ts      Provider registry with URL matching & auto-registration
      providerResolver.ts      Active provider resolution & fallback helper
      index.ts                 Provider subsystem barrel export
      gemini/                  Gemini platform adapter
        geminiProvider.ts      batchexecute RPC provider implementation

    api/                       Network clients, credentials, pagination and retries
      geminiClient.ts          Existing client; persisted result stays unchanged
      client/                  RPC transport and credential submodules

    parsers/                   Raw source decoding and direct Domain construction
      contracts.ts             Source parser context/result contracts (diagnostics beside Domain)
      parseConversation.ts     Explicit format dispatcher; conversation-record is a migration bridge
      gemini/rpc/              Wire extraction, source media and raw RPC → Domain
      gemini/takeout/           Activity HTML and ZIP bytes → Domain
      gemini/shared/            Gemini structured content and Markdown interpretation
      shared/                  Markdown/HTML, archive validation and resource/citation closure

    domain/                    Long-term semantic conversation contract and closure checks
      content/                 Content AST nodes, source references and semantic tree visitors

    document/
      ast/                     Format-neutral Document AST and resource reference visitors
      compose/                 Domain → Document AST composition

    renderers/                 Document AST + prepared resources → format output
      html/                    HTML renderer, template and math presentation
      markdown/                Markdown renderer
      typst/                   Typst renderer, templates, layout, math and private payload
      shared/                  Renderer options, strings and shared presentation policy

    compatibility/             Existing record/output behavior until producers migrate
      gemini/                  RPC facade, legacy filenames/paths and persisted detail projection
      takeout/                 Existing Takeout importer and inferred media correlation
      openai/                  Prototype archive importer; native Domain parser still pending
      record/                  Existing application record → Domain bridge
      archive/                 Existing localized ZIP guard errors

    diagnostics/               Parsing, composition and rendering problem records

    engine/                    Application export/import orchestration and writers
      exportEngine.ts          Batch export coordinator facade
      export/                  Workers, rate limiting, progress, recovery and completion
      takeoutEngine.ts         Existing Takeout import/cache facade
      chatFormatter.ts         Async Domain → Document AST Markdown/HTML facade; synchronous JSON & OpenAI serialization
      liveSaveWriter.ts        Async Document Markdown live-save formatting and FileSystem disk writes
      assetPipeline.ts         Media asset downloading & relative-path archive packaging
      writers/                 Pluggable Storage Writers
        writerInterface.ts     Unified Writer abstraction & factory
        zipWriter.ts           JSZip in-memory zip packaging writer (STORE mode for binary media)
        fsWriter.ts            FileSystem Access API directory tree writer

    export/                    Resource preparation, compilation and delivery orchestration
      exportDomainDocument.ts  Coordinates composition, resource preparation and rendering
      assets/                  Acquisition bytes and export/archive path naming
      pdf/                     PDF preparation and pipeline
      typst/                   Sandbox compiler, protocol and local font acquisition

    storage/                   Storage Abstraction & Persistence Layer
      storageService.ts        Multi-account slot chrome.storage.local abstraction & two-tier storage coordinator
      conversationDetailStore.ts IndexedDB heavy turn & message body detail store for two-tier storage architecture
      liveStorageManager.ts    Live auto-save configuration and FileSystem Directory Handle proxy
      idbHandleStore.ts        FileSystemDirectoryHandle IndexedDB persistence across sessions
      schemaMigration.ts       Storage schema version migration & legacy key upgrade runner
      sessionStore.ts          In-memory and chrome.storage.session recovery cache
      formatStore.ts           Export format preferences & template persistence

    utils/                     Single Source of Truth (SSoT) & Utilities
      utils.ts                 SSoT facade: title arbitration, deduplication, path cleaning
      titleUtils.ts            Title arbitration (rpc > api-detail > dom > takeout > openai > sniff > legacy > default)
      mergeUtils.ts            SSoT merge & deduplication (preserves highest-rank title & timestamps)
      pathUtils.ts             Strict relative path sanitization & filename builders
      chipUtils.ts             Internal chip URL filtering & code chip extraction
      progressUtils.ts         ETA, bitrate, and byte formatting utilities
      tabService.ts            Tab query, routing, and message failover
      messaging.ts             Type-safe chrome.runtime message dispatching
      moduleOverrides.ts       Dependency injection seam for deterministic unit testing
      environment.ts           Local development environment & debug flag detector
      i18n.ts                  Bilingual translation engine (locales/zh.ts, locales/en.ts)
      constants.ts             System constants, storage keys, format enums, version info

    protocol/                  Wire Protocols & Event Contracts
      protocol.ts              Wire RPC identifiers (RPCS.LIST, RPCS.DELETE), deletion anchors
      events.ts                Strongly typed cross-world and internal event interfaces

  types/                       Shared TypeScript Type Contracts
    index.ts                   Central type barrel export
    conversation.ts            Conversation, ChatTurn, ChatMessage & Attachment interfaces
    entrypoints.ts             Module entrypoint & facade type definitions
    errors.ts                  Structured error codes & custom error contracts
    global.d.ts                Ambient global & window declarations
    liveSave.ts                Live auto-save state & configuration types
    messages.ts                Cross-context runtime message discriminated unions
    ui.ts                      Workbench & view state interfaces
    utils.ts                   Utility & title arbitration contract types

  ui/                          User Interface Subsystem
    options/                   Workbench Subsystem
      options.html             Workbench markup
      options.ts               Workbench entrypoint & module coordinator (bundled to dist/ui/options.js)
      optionsContext.ts        Shared options page dependency context
      modules/                 Decomposed Options UI Sub-modules
        optionsInit.ts         Initialization, slot loading & DOM binding
        optionsExport.ts       Export button binding & progress orchestration
        optionsSync.ts         Quick Sync & Deep Scan coordinators
        optionsTakeout.ts      Takeout drag-and-drop & import coordinator
        optionsSettings.ts     Language toggle, dev mode & diagnostic console
    popup/                     Browser Action Popup Subsystem
      popup.html               Popup markup
      popup.ts                 Quick export & options launcher (bundled to dist/ui/popup.js)
    state/
      conversationsStore.ts    Reactive conversation state machine, filter & sort manager
    views/
      listView.ts              Conversation list & selection renderer
      progressView.ts          Batch export & scanning modal progress bar with ETA
      accountView.ts           Multi-account slot selector dropdown
      dialogView.ts            Session recovery banner & confirmation modal dialogs
      logView.ts               Diagnostic console log view
    controllers/
      exportController.ts      Export execution & progress orchestration
      syncController.ts        Incremental & deep history scan coordinator
      takeoutController.ts     Takeout ZIP import & conflict resolution
      dirHandleController.ts   FileSystem Access API picker & permission coordinator
    tour/
      tourGuide.ts             6-step onboarding walkthrough & highlight mask engine
      tourSteps.ts             Step definitions & instructional text
      tourPosition.ts          Tooltip dynamic geometry & anchor position calculations
      tourGuide.css            Onboarding spotlight & callout styling
      featureReleases.ts       Release notes & new feature banners
    utils/
      domI18n.ts               DOM-based i18n renderer & language switch UI bindings (isolated from Core)
    uiCommon.ts                DOM helpers ($) and i18n bridging
```

---

## ⚡ Build System: esbuild Pure Bundle Architecture

Gemini Exporter compiles its TypeScript source tree using `esbuild` (`build.js`) in a single pass:

| Output Bundle Artifact | Source Entrypoint | Execution World | Description |
|---|---|---|---|
| `dist/content/content.js` | `src/content/content.ts` | ISOLATED World | Content script entrypoint, observers, sync engine & badge view |
| `dist/content/hook.js` | `src/content/hookCredentials.ts` | MAIN World | Host page XHR/Fetch network interceptor & credential sniffer |
| `dist/background/background.js` | `src/background/background.ts` | Service Worker | Background worker, lifecycle, keepalive, abort state & batch fetcher |
| `dist/ui/popup.js` | `src/ui/popup/popup.ts` | Extension Page | Popup action center: quick export & workbench launcher |
| `dist/ui/options.js` | `src/ui/options/options.ts` | Extension Page | Workbench dashboard: batch selection, Takeout import, sync & export |

All bundles are generated in `< 30ms` with minification and sourcemaps.

---

## 🛡️ Architectural Rules & Invariants

1. **Zero DOM Dependencies in Core (Zero DOM Baseline & Layered Browser API Policy)**:
   `src/core/` organizes modules by domain responsibility with a strict boundary on browser API usage:
   - **Strict Zero-DOM / Zero-Browser-API Layer (Pure Logic)**: Response parsers (`parsers/*`), formatters (`chatFormatter.ts`, `renderers/html/htmlTemplate.ts`), pure utilities (`titleUtils.ts`, `mergeUtils.ts`, `pathUtils.ts`, `progressUtils.ts`, `chipUtils.ts`), protocol constants (`protocol/*`), and provider interfaces (`aiProvider.ts`). These modules never touch `document`, `HTMLElement`, or `window`, running identically in Node.js unit tests, Service Workers, and UI pages.
   - **Runtime Infrastructure Layer (Standard Browser APIs Allowed, Zero DOM Rendering)**: API client (`api/client/*`), storage (`storage/*`), writers (`writers/*`), tab routing (`tabService.ts`), and export orchestration (`exportOrchestrator.ts`). These may use standard runtime APIs (`fetch`, `chrome.*`, `IndexedDB`, `FileSystem Access API`, plus read-only `querySelectorAll("script")` in `credentialManager.ts` and legacy `(window as any).__gemExporterAborted` fallback in `geminiClient.ts`/`pagination.ts`), but **never perform DOM rendering or mutation**, which belongs exclusively to `src/ui/` (including `src/ui/utils/domI18n.ts`) and `src/content/`.
2. **Strict UI Separation of Concerns**:
   - `state/`: Unidirectional data flow and reactive conversation state machine;
   - `views/`: Stateless DOM template generation, list rendering, and event bubble binding;
   - `controllers/`: Business workflow orchestration and asynchronous execution;
   - `options.ts` / `popup.ts`: Pure entrypoint mount and sub-module coordinators.
3. **Single Source of Truth (SSoT) & Title Anti-Degradation**:
   Path sanitization (`pathUtils.ts`), title arbitration (`titleUtils.ts`), and list merging (`mergeUtils.ts`) reside exclusively in `src/core/utils/`. No module may roll its own regexes for title cleaning or sorting. Source selection order: `rpc > api-detail > dom > takeout > openai > sniff > legacy > default`. Rank ties remain `rpc = api-detail` and `takeout = openai`; source selection uses the listed order.
4. **Sandboxed Interceptors Guard**:
   Code injected into `MAIN` world (`hookCredentials.ts`) runs in a fail-safe sandbox: any unexpected exception is swallowed silently to guarantee zero degradation of native Google Gemini functionality.
5. **Event-Driven AsyncQueue & Controlled Polling Boundary**:
   All batch exports and downloads are driven by `AsyncQueue` worker pools (default concurrency: 3) combined with `RateLimiter` exponential backoff state machines to intelligently avoid HTTP 429 rate limits.
6. **MV3 Service Worker Keepalive Resilience**:
   Regular lightweight heartbeat pings keep the MV3 Service Worker alive during lengthy deep scans and multi-megabyte media packaging tasks, preventing unexpected background worker termination by Chromium.
7. **Two-Tier Storage & Quota Isolation**:
   `chrome.storage.local` strictly stores lightweight conversation metadata index (`id`, `title`, `timestamp`, `updatedAt`, `snippet`, `count`), maintaining memory well below Chrome's 10MB quota ceiling. Heavy conversation turns, full messages, and media references are persisted in IndexedDB via `conversationDetailStore.ts`, completely eliminating storage quota exhaustion and data truncation.
8. **Headless FileSystem Permission Resilience**:
   When Service Worker executes in headless background and directory handle permissions drop to `prompt` upon browser restart (where Chromium forbids headless permission prompting), the system safely returns `permission_prompt_needed` and records `dirError` in live config, allowing 1-click reauthorization via user gesture (`reauthorizeDirHandle()`).
9. **Multi-Account Strict Isolation & Zero Token Stealing**:
   The multi-account subsystem is anchored to real Google Profiles (email, name, Gaia ID) sniffed via `accountSniffer.ts`. Each account slot maintains an isolated credential and conversation namespace with zero cross-slot token borrowing. Cross-tab dispatching strictly matches the active account slot, rejecting dispatch if no matching tab is found.


## Scoped Zero-Any Gate

Run `node scripts/check-zero-any.cjs` locally. `npm test` and the CI `Unit Tests & Syntax`
job enforce the same Oxlint `typescript/no-explicit-any` rule. The initial
protected scope is exactly `src/core/utils/titleUtils.ts` and
`src/core/utils/mergeUtils.ts`; legacy core files and tests remain outside it.
To expand coverage, clean a production file first, then add its path to the
`scripts/check-zero-any.cjs` script. No dependency upgrade is needed.

In protected production core code, `as any`, explicit `any`, `any[]`, and
`Record<string, any>` are forbidden. `unknown` is allowed; type narrowing is
preferred. Double-cast bypasses such as `as unknown as SomeType` and lint
suppression comments are forbidden by review.

## Semantic dependency boundaries

The [semantic layer architecture tests](../tests/arch/) check source imports and re-exports, including erased type dependencies, and follow runtime dependencies through shared helpers. Domain and Document AST do not import parsers or output backends. Native source parsers do not load storage, export naming, renderers or legacy projections. Renderers consume Document AST and prepared resources without reaching source parsers or Domain. The unified dispatcher has an explicit, limited dependency on the existing conversation-record bridge.

The storage directory, persisted conversation shape, storage keys and serializers are unchanged. A directory move does not mean the corresponding production caller has migrated to raw → Domain. See [parser migration status](../docs/domain-model.md#migration-order-and-acceptance).
