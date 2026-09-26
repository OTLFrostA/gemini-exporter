/**
 * src/ui/sandbox/offlineInit.ts
 *
 * Typst compiler init options for the sandbox page.
 *
 * Iron rule (P0 gate): the compiler must NEVER fetch anything from the
 * network. typst.ts defaults to pulling ~17 font files from jsdelivr at
 * build time; `loadFonts([], { assets: false })` disables the remote font
 * assets entirely. The only fonts the compiler ever sees are the ones the
 * extension host explicitly sends over postMessage.
 *
 * Pure module (no DOM): unit tests assert the offline configuration here
 * without spinning up the WASM compiler.
 */

import { loadFonts } from '@myriaddreamin/typst.ts';
import type { InitOptions } from '@myriaddreamin/typst.ts';

/**
 * Build compiler.init() options that load the WASM module from the given
 * bytes and disable all remote font fetching.
 */
export function createOfflineInitOptions(
    getModule: () => Uint8Array | Promise<Uint8Array>,
): Partial<InitOptions> {
    return {
        getModule,
        beforeBuild: [loadFonts([], { assets: false })],
    };
}
