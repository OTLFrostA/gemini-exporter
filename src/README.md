# Layered Architecture

This refactor introduces explicit layering to prevent format/UI/storage regressions:

```
src/core/          Pure logic, no DOM, no chrome.sideEffect except storage
  constants.js     ALLOWED_FORMATS, DEFAULT_FORMAT, STORAGE_KEYS
  formatStore.js   normalize/validate/load/save format, dev-aware, select-aware
  (utils.js, storage_service.js, chat_formatter.js, export_engine.js are already pure)

src/ui/
  state/conversationsStore.js  conversations/exportedIds/currentSlot/accountSlots, load/save
  views/listView.js            renderList/updateStat/getSelected (DOM only)
  views/logView.js             log buffer + render (DOM only)
  controllers/exportController.js  ExportEngine orchestration (callbacks -> views)

content/ + background/         Gemini API / DOM scraping / message routing (existing files)
ui/popup + ui/options          Thin orchestrators: wire core + views + controllers
```

## Rules

- **core** never touches `document` except via passed element; validated via unit tests.
- **ui/state** only data, **ui/views** only rendering, **ui/controllers** only orchestration.
- `options.html`/`popup.html` load `src/core/*` first, then `src/ui/*`, then legacy `options.js`/`options-popup.js` which now delegate to `FormatStore`/`LogView`/`ExportController` if present (fallback keeps backward compat).

## Benefits

- `format` drift fixed: single source `src/core/constants.js::ALLOWED_FORMATS` + `src/core/formatStore.js::normalizeFormat`.
- `btnClearExported` / dev edge no longer spread across monolith.
- `options.js` from 1100→~900 lines thin coordinator.
