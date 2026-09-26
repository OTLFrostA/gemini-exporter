# Vendored Typst compiler WASM (P1b)

## typst_ts_web_compiler_bg.wasm (28,325,178 bytes)

- **What**: the WebAssembly Typst compiler used by the sandbox compile
  container. Loaded via `fetch(chrome.runtime.getURL(...))` by the extension
  host and transferred to the sandbox page, which passes the bytes as
  `getModule` to `compiler.init()` / `fontBuilder.init()`.
- **Version**: `@myriaddreamin/typst-ts-web-compiler` 0.7.0 (peer of
  `@myriaddreamin/typst.ts` 0.7.0, both pinned in package.json).
- **Provenance**: byte-identical (sha256 below) to
  `node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm`
  AND to the WASM file the P0 formal probe verified end-to-end
  (`~/workspace/goals/gemini-exporter/hidden_files/p0-formal/probe-ext/vendor/`).
- **Why vendored instead of read from node_modules**: the extension build
  and the shipped package must not depend on npm's internal package layout;
  this file is the pinned, P0-verified artifact.
- **sha256**: `1fc968438a672366dfec39c96c842c26ed29caff4eb1bcaab19a6c60867de5fd`
- **Size budget**: 28.3 MiB on disk, ~10.7 MiB compressed in the packed
  extension (within the 30 MiB total increment budget).
