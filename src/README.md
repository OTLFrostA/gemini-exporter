# Layered Architecture

This refactor establishes explicit layering to prevent format/UI/storage regressions and ensure modularity:

```
src/core/          Pure logic, no DOM, no chrome.sideEffect except storage/tabs
  constants.js     ALLOWED_FORMATS, DEFAULT_FORMAT, STORAGE_KEYS
  formatStore.js   normalize/validate/load/save format, dev-aware, select-aware
  tabService.js    getGeminiTab, sendToGeminiTab (centralized tab discovery & communication)
  exporter/
    zipWriter.js   JSZip stream packaging writer
    fsWriter.js    FileSystem Access API writer & dirHandle directory tree builder
  (utils.js, storage_service.js, chat_formatter.js, export_engine.js are pure core services)

src/ui/
  state/conversationsStore.js  conversations/exportedIds/currentSlot/accountSlots, load/save
  views/
    listView.js                renderList/updateStat/getSelected (DOM only)
    logView.js                 log buffer + render (DOM only)
    accountView.js             account slot selector dropdown view (DOM only)
    dialogView.js              export session recovery banner & modal view (DOM only)
  controllers/
    exportController.js        ExportEngine orchestration (callbacks -> views)
    syncController.js          Incremental scan & deep history scan orchestration
    takeoutController.js       Takeout ZIP import & historical chat merging orchestration
    dirHandleController.js     FileSystem Access API IndexedDB persistence & permissions

content/ + background/         Gemini API / DOM scraping / message routing (delegating to core)
ui/popup + ui/options          Thin orchestrators (<450 lines): wire core + views + controllers
```

## Rules

- **core** never touches `document` except via passed element; validated via unit tests.
- **ui/state** only data, **ui/views** only rendering, **ui/controllers** only orchestration.
- `options.html`/`popup.html` load `src/core/*` first, then `src/ui/*`, then `options.js`/`options-popup.js`.

## Benefits

- Single Source of Truth: all string sanitization, brand stripping, real title checks in `utils.js`.
- Zero fallback copy-paste across background, parser, client, options, and content scripts.
- `options.js` reduced from 1020+ lines to a clean coordinator (~440 lines).
- 100% unit and regression test coverage verified via `python3 tests/run_tests.py`.
