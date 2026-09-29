# Vendored MiTeX Engine & Scope Provenance

This directory vendors the WebAssembly build and JavaScript bindings of the MiTeX LaTeX-to-Typst math engine, paired with the Typst scope definitions located at `src/core/export/typst/templates/mitex-scope.typ`.

## Version and Upstream Source

- **Upstream Project**: [MiTeX](https://github.com/mitex-rs/mitex)
- **Component**: `mitex-wasm` (npm package) / `@preview/mitex` (Typst universe package)
- **Exact Upstream Version**: `v0.2.5`
- **Upstream Package URLs**:
  - npm package: `https://registry.npmjs.org/mitex-wasm/-/mitex-wasm-0.2.5.tgz`
  - Typst package: `https://packages.typst.org/preview/mitex-0.2.5.tar.gz`
  - Repository: `https://github.com/mitex-rs/mitex`
- **License**: Apache-2.0

## Vendored Artifacts & SHA256 Integrity

1. `mitex_wasm_bg.wasm`:
   - Source: `mitex-wasm` v0.2.5 npm release
   - File Size: `230,735` bytes
   - SHA256: `7907415f9e7bbc8447dd2ac1d9a4b7bbc3f4f42b96f855d41883dc39f904c0cf`
2. `mitex_wasm_bg.js` & `mitex_wasm_bg.d.ts`:
   - Source: `mitex-wasm` v0.2.5 npm release (matching `wasm-bindgen` bindings)
3. `src/core/export/typst/templates/mitex-scope.typ`:
   - Source: `@preview/mitex:0.2.5` Typst package (`specs/prelude.typ` and `specs/latex/standard.typ`)
   - Pure Typst dictionary with zero plugin/WASM dependencies (compatible with Typst 0.12+; deprecated `kai` symbol mapped to unicode `\u{03d7}`)

All artifacts are verified byte-for-byte and AST-for-AST against upstream v0.2.5 releases and constitute a single, indivisible version unit.

## Update & Governance Policy

- **Single Version Unit**: `mitex_wasm_bg.wasm`, `mitex_wasm_bg.js`, `mitex_wasm_bg.d.ts`, and `mitex-scope.typ` must always be updated together as a single upstream version unit. Never update the WASM binary or scope independently.
- **No Speculative Aliases**: Adding project-specific LaTeX command mappings or speculative aliases directly to `mitex-scope.typ` is strictly prohibited. Standard TeX/LaTeX behavior is preserved.
