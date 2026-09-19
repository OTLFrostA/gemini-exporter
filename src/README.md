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
    messageBridge.ts           Cross-world window.postMessage bridge (MAIN -> ISOLATED)
    liveSaveObserver.ts        Gemini generation completion & DOM mutation debounced observer
    liveSaveCoordinator.ts     Real-time live auto-save coordinator (RPC/DOM -> IndexedDB & Disk)
    syncEngine.ts              Incremental & deep history scan coordinator
    domScraper.ts              DOM fallback scraper when RPC payloads are unavailable
    badgeView.ts               Floating sync & live save feedback badge in Gemini web UI
    screenshotCapture.ts       Scrolling container multi-frame viewport capture
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
      gemini/                  Gemini platform adapter
        geminiProvider.ts      batchexecute RPC provider implementation
      chatgpt/                 ChatGPT platform adapter
        chatgptProvider.ts     ChatGPT DOM & API provider implementation

    api/                       Protocol Communication & Deserialization
      geminiClient.ts          batchexecute RPC client facade (abort, retry, token refresh)
      geminiParser.ts          Protocol parsing, turns, attachments & title extraction facade
      client/                  Granular RPC & Credential Sub-modules
        credentialManager.ts   SNlM0e token, session slot & credential resolution
        pagination.ts          batchexecute pagination & list/detail cursor fetching
        retryPolicy.ts         Exponential backoff, 400 XSRF auto-refresh & 429 backoff
        rpcClient.ts           batchexecute payload construction & envelope parsing
        credStorage.ts         Credential cache storage helper
      parser/                  Granular Wire Format Parsing Sub-modules
        parseList.ts           batchexecute conversation list item extraction
        parseDetail.ts         Multi-turn conversation recursion & schema drift detection
        extractors.ts          Thought blocks, candidate text, citations & title extractors
        attachments.ts         Image, user file, and Deep Research document attachments
        payload.ts             Low-level JSPB payload unpackers

    engine/                    Export, Conversion & Packaging Engines
      exportEngine.ts          Export pipeline coordinator facade (delegates to ExportOrchestrator)
      export/                  Export Execution Sub-modules
        exportOrchestrator.ts  Batch export orchestration & AsyncQueue worker pool
        batchWorker.ts         Individual conversation worker (fetch -> format -> write)
        rateLimiter.ts         Adaptive rate limiting & circuit breaker state machine
        progressReporter.ts    Real-time progress, ETA, and throughput calculation
        sessionRecovery.ts     Session recovery persistence & crash resumption
      takeoutEngine.ts         Google Takeout archive parser facade
      takeout/                 Takeout Sub-modules
        takeoutParser.ts       Takeout ZIP stream parser & entry iterator
        takeoutHtmlParser.ts   Offline HTML stripper & prompt title extractor
        mediaIndex.ts          C2PA timestamp indexing & media pool mapping
        zipBombGuard.ts        ZIP bomb security validation & entry bounds checking
      chatFormatter.ts         CommonMark (YAML Frontmatter), JSON, OpenAI formatters
      liveSaveWriter.ts        High-speed live save disk writer for FileSystem Directory Handle
      screenshotStitcher.ts    Non-overlapping frame layout calculation & offscreen canvas stitcher
      pdfWrapper.ts            Zero-dependency native PDF 1.4 binary stream generator (/DCTDecode)
      assetPipeline.ts         Media asset downloading, C2PA validation & ZIP packaging
      writers/                 Pluggable Storage Writers
        writerInterface.ts     Unified Writer abstraction & factory
        zipWriter.ts           JSZip in-memory zip packaging writer
        fsWriter.ts            FileSystem Access API directory tree writer

    storage/                   Storage Abstraction & Persistence Layer
      storageService.ts        Multi-account slot chrome.storage.local abstraction
      liveStorageManager.ts    IndexedDB mirror database for real-time live save (gemini_live_conversations)
      idbHandleStore.ts        FileSystemDirectoryHandle IndexedDB persistence across sessions
      sessionStore.ts          In-memory and chrome.storage.session recovery cache
      formatStore.ts           Export format preferences & template persistence

    utils/                     Single Source of Truth (SSoT) & Utilities
      utils.ts                 SSoT facade: title arbitration, deduplication, path cleaning
      titleUtils.ts            Multi-tier title arbitration (RPC > Detail > Prompt > Takeout)
      mergeUtils.ts            SSoT merge & deduplication (preserves highest-rank title & timestamps)
      pathUtils.ts             Strict relative path sanitization & filename builders
      chipUtils.ts             Internal chip URL filtering & code chip extraction
      progressUtils.ts         ETA, bitrate, and byte formatting utilities
      tabService.ts            Tab query, routing, and message failover
      messaging.ts             Type-safe chrome.runtime message dispatching
      moduleOverrides.ts       Dependency injection seam for deterministic unit testing
      i18n.ts                  Bilingual translation engine (locales/zh.ts, locales/en.ts)
      constants.ts             System constants, storage keys, format enums, version info

    protocol/                  Wire Protocols & Event Contracts
      protocol.ts              Wire RPC identifiers (RPCS.LIST, RPCS.DELETE), deletion anchors
      events.ts                Strongly typed cross-world and internal event interfaces

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
      popup.ts                 Quick export, long screenshot & PDF coordinator (bundled to dist/ui/popup.js)
    state/
      conversationsStore.ts    Reactive conversation state machine, filter & selection manager
    views/
      listView.ts              Virtual conversation list & selection renderer
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
      tourGuide.ts             5-step onboarding walkthrough & highlight mask engine
      tourSteps.ts             Step definitions & instructional text
      tourPosition.ts          Tooltip dynamic geometry & anchor position calculations
      tourGuide.css            Onboarding spotlight & callout styling
      featureReleases.ts       Release notes & new feature banners
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
| `dist/ui/popup.js` | `src/ui/popup/popup.ts` | Extension Page | Popup action center: quick export, long screenshot stitcher & PDF |
| `dist/ui/options.js` | `src/ui/options/options.ts` | Extension Page | Workbench dashboard: batch selection, Takeout import, sync & export |

All bundles are generated in `< 30ms` with minification and sourcemaps.

---

## 🛡️ Architectural Rules & Invariants

1. **Zero DOM Dependencies in Core**:
   `src/core/` algorithms (parsing, formatting, title arbitration, rate limiting, takeout parsing, PDF binary stream generation) must never touch browser DOM elements. They execute identically in Node.js unit tests, Web Workers, Service Workers, and UI pages.
2. **Single Source of Truth (SSoT)**:
   Path sanitization (`pathUtils.ts`), title arbitration (`titleUtils.ts`), and list merging (`mergeUtils.ts`) reside exclusively in `src/core/utils/`. No module may roll its own regexes for title cleaning or sorting.
3. **Pluggable AI Provider**:
   New AI engines must implement the `AIProvider` contract in `src/core/provider/aiProvider.ts` and register with `ProviderRegistry`.
4. **Sandboxed Interceptors**:
   Code injected into `MAIN` world (`hookCredentials.ts`) runs in a fail-safe sandbox: any unexpected exception is swallowed silently to guarantee zero degradation of native Google Gemini functionality.
