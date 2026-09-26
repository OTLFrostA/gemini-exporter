/**
 * src/core/export/typst/index.ts
 * Public entry for the Typst PDF bridge (P1a).
 *
 * Pure addition: templates + canonical->payload adapter. No WASM loading,
 * no sandbox page (P1b), no export UI wiring (P3).
 */

export * from './payload.js';
export * from './fonts/localFontProvider.js';
export * from './sandboxProtocol.js';
export { TypstSandboxCompiler } from './typstSandboxCompiler.js';
export type {
    SandboxFrame,
    SandboxHost,
    TypstSandboxCompilerOptions,
} from './typstSandboxCompiler.js';
export { BrowserSandboxHost, fontHasMathTable, stripConvertedMath } from './typstSandboxCompiler.js';
