import type {
    RenderContext,
    RenderDiagnostic,
    TypstRenderPayload,
} from '../canonical/rendering.js';

export const STUB_PDF_COMPILER_NAME = 'stub-pdf-compiler';

export interface PdfCompileResult {
    pdfBytes: Uint8Array;
    diagnostics: RenderDiagnostic[];
}

export interface IPdfCompiler {
    readonly name: string;
    compile(payload: TypstRenderPayload, context: RenderContext): Promise<PdfCompileResult>;
}

/** Computes real xref byte offsets so the output passes structural PDF verification. */
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
    failWith?: string;
    delayMs?: number;
}

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
