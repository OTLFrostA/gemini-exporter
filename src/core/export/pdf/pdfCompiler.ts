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
/**
 * Builds a minimal but genuinely valid one-page PDF: real indirect objects,
 * a classic xref table whose byte offsets are computed (never hardcoded),
 * and a startxref pointer aimed at the actual xref table.
 *
 * Test fixtures and the stub compiler MUST use this. Hand-written
 * "startxref 0" fixtures are not valid PDFs (offset 0 points at the
 * %PDF- header, not a cross-reference table) and are rejected by the S4
 * verifier's pointer check.
 */
export function buildMinimalValidPdf(): Uint8Array {
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        '<< /Length 44 >>\nstream\nBT /F1 24 Tf 72 720 Td (stub pdf) Tj ET\nendstream',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let body = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((dict, i) => {
        offsets.push(body.length);
        body += `${i + 1} 0 obj\n${dict}\nendobj\n`;
    });
    const xrefOffset = body.length;
    let xref = 'xref\n0 6\n0000000000 65535 f \n';
    for (const off of offsets) {
        xref += `${String(off).padStart(10, '0')} 00000 n \n`;
    }
    const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return new TextEncoder().encode(body + xref + trailer);
}

function minimalPdfBytes(): Uint8Array {
    return buildMinimalValidPdf();
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
 * Exists ONLY so P3 (UI + batch orchestration + Writer) can be built,
 * tested and merged in parallel with P1b/P2. P1b replaces this file's
 * export with the real implementation behind the same IPdfCompiler
 * interface. Not for production use: output carries no real content.
 */
export class StubPdfCompiler implements IPdfCompiler {
    readonly name = 'stub-pdf-compiler';

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
