# System Architecture & Layering

Gemini Exporter enforces a strict 4-tier modular architecture across Chrome MV3 boundaries and domain responsibilities:

```
src/
  background/                  Extension Service Worker Subsystem
    background.js              Message routing, session monitoring, tab delegation

  content/                     Injected Gemini Content Script Subsystem
    content.js                 In-page DOM & sync coordinator
    content.css                Sync status floating UI & badge styles
    bootstrap.js               Page token & credential bootstrap
    hookCredentials.js         MAIN world network interceptor & credential bridge

  core/                        Pure Domain Logic & Engine (Decoupled from DOM)
    api/
      geminiClient.js          batchexecute RPC client & abort handling
      geminiParser.js          Protocol parsing, turns, attachments & title extraction
    engine/
      exportEngine.js          Export pipeline coordinator (streaming & recovery)
      takeoutEngine.js         Google Takeout archive parser & offline fallback
      chatFormatter.js         Markdown, JSON, OpenAI schema formatters
      assetFetcher.js          Media, images, and blob streaming fetcher
      domScraper.js            DOM fallback scraper
      writers/
        zipWriter.js           JSZip in-memory zip packaging writer
        fsWriter.js            FileSystem Access API directory tree writer
    storage/
      storageService.js        Multi-account slot chrome.storage abstraction
      formatStore.js           Export format validation & persistence
    utils/
      utils.js                 Single Source of Truth: title arbitration & sanitization
      constants.js             Enums, format definitions, storage keys
      tabService.js            Tab query, routing, and message failover
      i18n.js                  Bilingual dictionary & translation engine

  ui/                          User Interface Subsystem
    options/
      options.html             Options Workbench markup
      options.js               Workbench coordinator
    popup/
      popup.html               Browser action popup markup
      popup.js                 Quick export & popup coordinator
    state/
      conversationsStore.js    Reactive conversation state & slot manager
    views/
      listView.js              Virtual conversation list & selection renderer
      logView.js               Diagnostic console log view
      accountView.js           Multi-account slot selector dropdown
      dialogView.js            Session recovery banner & modal view
    controllers/
      exportController.js      Export execution & progress orchestration
      syncController.js        Incremental & deep history scan coordinator
      takeoutController.js     Takeout ZIP import & conflict resolution
      dirHandleController.js   FileSystem Access API IndexedDB persistence
```

## Architectural Rules

1. **`core` has zero DOM dependencies**: Core algorithms (parsing, formatting, title arbitration) run identically in Node.js unit tests, extension service workers, and UI pages.
2. **Strict UI Separation**: `state` handles storage sync, `views` handles HTML rendering, `controllers` orchestrates workflows, and `options.js` acts as a thin coordinator.
3. **Single Source of Truth**: All string sanitization, filename cleaning, and multi-tier title arbitration logic resides exclusively in `src/core/utils/utils.js`.
4. **100% Test Coverage**: All core modules are verified by Node.js unit tests (`tests/*.test.js`) and Playwright E2E browser tests (`tests/e2e/*.spec.js`).
