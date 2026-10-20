import type { Diagnostic as RenderDiagnostic } from '../../../../../shared/diagnostics/diagnostic.js';
import type { IPdfCompiler } from '../../pdfCompiler.js';
import type { RuntimeFontConsumer } from '../typstSandboxCompiler.js';
import { BUNDLED_MATH_FALLBACK, SYSTEM_FALLBACK, type LocalFontResolution } from './localFontProvider.js';

export interface MountedRuntimeFonts {
    readonly mountedCount: number;
    readonly mountedNames: readonly string[];
    readonly diagnostics: RenderDiagnostic[];
    readonly effectiveFonts: LocalFontResolution;
}

export async function mountRuntimeFonts(
    resolution: LocalFontResolution,
    compiler: IPdfCompiler,
): Promise<MountedRuntimeFonts> {
    const consumer = compiler as unknown as RuntimeFontConsumer;
    if (typeof consumer.setRuntimeFonts !== 'function') {
        return {
            mountedCount: 0,
            mountedNames: [],
            diagnostics: [],
            effectiveFonts: { ...resolution, localFontsAvailable: false },
        };
    }
    const bytes: Uint8Array[] = [];
    const names: string[] = [];
    const diagnostics: RenderDiagnostic[] = [];
    for (const font of resolution.fonts) {
        try {
            const data = await font.getBytes();
            if (data && data.length > 0) {
                bytes.push(data);
                names.push(`${font.family} (local, ${font.postscriptName})`);
            } else {
                diagnostics.push({
                    severity: 'warning',
                    code: 'TYPST_LOCAL_FONT_READ_FAILED',
                    message: `Local font "${font.family}" (${font.postscriptName}) returned empty bytes; it will not be mounted in the Typst sandbox.`,
                });
            }
        } catch (e) {
            diagnostics.push({
                severity: 'warning',
                code: 'TYPST_LOCAL_FONT_READ_FAILED',
                message: `Local font "${font.family}" (${font.postscriptName}) failed to read bytes (${
                    (e as Error)?.message ?? String(e)
                }); it will not be mounted in the Typst sandbox.`,
            });
        }
    }
    consumer.setRuntimeFonts(bytes);
    const effectiveFonts: LocalFontResolution = {
        fonts: [],
        diagnostics: [...resolution.diagnostics, ...diagnostics],
        fallbackChain: [...names, BUNDLED_MATH_FALLBACK, SYSTEM_FALLBACK],
        localFontsAvailable: bytes.length > 0,
    };
    return { mountedCount: bytes.length, mountedNames: names, diagnostics, effectiveFonts };
}

