/**
 * src/core/export/typst/index.ts
 * Public entry for the Typst PDF bridge (P1a).
 *
 * Pure addition: templates + canonical->payload adapter. No WASM loading,
 * no sandbox page (P1b), no export UI wiring (P3).
 */

export * from './payload.js';
