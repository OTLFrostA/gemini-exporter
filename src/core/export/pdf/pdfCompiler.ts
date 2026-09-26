/**
 * src/core/export/pdf/pdfCompiler.ts
 *
 * Frozen PDF compile interface for the PDF export route.
 *
 * P1b WILL REPLACE the stub below with the real Typst compiler
 * (sandbox page + postMessage, WASM). The interface is frozen: P1b must
 * implement IPdfCompiler, not change it. If P1b finds the interface truly
 * insufficient, it must report back instead of silently widening it.
 *
 * Compile contract:
 * - input:  TypstRenderPayload (canonical bundle; P1a fills messageHints/
 *           convertedMath) + RenderContext (bundle, assets, locale,
 *           AbortSignal, reportProgress)
 * - output: { pdfBytes, diagnostics }
 * - cancellation: implementations MUST stop promptly when
 *   context.signal aborts and throw a DOMException named 'AbortError'.
 * - no silent loss: every dropped/omitted piece of content must surface
 *   as a diagnostic, never disappear quietly.
 */

import type {
    RenderContext,
    RenderDiagnostic,
    TypstRenderPayload,
} from '../canonical/rendering.js';

/**
 * Stable compiler name of the test stub. The D7 M6 stub gate in
 * pdfExporter.ts matches on this name (not instanceof) so a stub can never
 * silently reach the production export path, even across bundle boundaries.
 */
export const STUB_PDF_COMPILER_NAME = 'stub-pdf-compiler';

export interface PdfCompileResult {
    pdfBytes: Uint8Array;
    diagnostics: RenderDiagnostic[];
}

export interface IPdfCompiler {
    /** Stable name for logs/diagnostics, e.g. 'typst-wasm' or 'stub'. */
    readonly name: string;
    compile(payload: TypstRenderPayload, context: RenderContext): Promise<PdfCompileResult>;
}

/**
 * Minimal one-page PDF used by the stub. Parseable, text-extractable,
 * deliberately content-free: it only proves the plumbing (normalize ->
 * compile -> writer) works end to end.
 */
const MINIMAL_PDF_TEXT = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    '4 0 obj<</Length 44>>stream',
    'BT /F1 24 Tf 72 720 Td (stub pdf) Tj ET',
    'endstream',
    'endobj',
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
    'trailer<</Root 1 0 R>>',
    'startxref',
    '0',
    '%%EOF',
    '',
].join('\n');

function minimalPdfBytes(): Uint8Array {
    return new TextEncoder().encode(MINIMAL_PDF_TEXT);
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('PDF compile aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('PDF compile aborted', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

export interface StubPdfCompilerOptions {
    /**
     * When set, compile() throws Error(failWith) instead of returning a
     * PDF. Deterministic failure for Tier 1 tests and UI retry drills.
     */
    failWith?: string;
    /**
     * Artificial delay in ms before producing output. Lets cancellation
     * tests win the race deterministically.
     */
    delayMs?: number;
}

/**
 * StubPdfCompiler — deterministic stand-in for the real Typst compiler.
 *
 * Exists ONLY so tests and parallel UI work can run the export plumbing
 * without the WASM sandbox. Test-only: D7 M6 gates the production export
 * path against this class (see the stub gate in pdfExporter.ts) — a stub
 * reaching production without an explicit `allowStub` opt-in is a hard
 * error, never a silent placeholder PDF.
 */
export class StubPdfCompiler implements IPdfCompiler {
    readonly name = STUB_PDF_COMPILER_NAME;

    constructor(private readonly options: StubPdfCompilerOptions = {}) {}

    async compile(payload: TypstRenderPayload, context: RenderContext): Promise<PdfCompileResult> {
        context.reportProgress('stub-compile-start', 0, 1);
        await abortableSleep(this.options.delayMs ?? 0, context.signal);
        if (context.signal.aborted) {
            throw new DOMException('PDF compile aborted', 'AbortError');
        }
        if (this.options.failWith) {
            throw new Error(this.options.failWith);
        }
        const messageCount = payload.bundle.conversation.messages.length;
        context.reportProgress('stub-compile-done', 1, 1);
        return {
            pdfBytes: minimalPdfBytes(),
            diagnostics: [
                {
                    severity: 'info',
                    code: 'STUB_COMPILER_PLACEHOLDER',
                    message:
                        `Stub compiler produced a placeholder PDF for ${messageCount} message(s); ` +
                        `P1b will replace this with the real Typst compile.`,
                },
            ],
        };
    }
}
