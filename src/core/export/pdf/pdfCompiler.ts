import type { DocumentDiagnostic } from '../../diagnostics/documentDiagnostic.js';
import type { TypstConversationRenderPayload } from '../../renderers/typst/transport.js';

/** Prepared output bytes, never a semantic Asset or source conversation. */
export interface PdfResource { blob?: Blob; bytes?: Uint8Array }
export interface PdfCompileContext {
    assets: { resolve(resourceId: string): Promise<PdfResource | null> };
    signal: AbortSignal;
    reportProgress(stage: string, current: number, total: number): void;
}
export interface TypstRenderPayload {
    rendererSchemaVersion: 1;
    document: TypstConversationRenderPayload;
    assetPaths: ReadonlyMap<string, string>;
}
export interface PdfCompileResult {
    pdfBytes: Uint8Array;
    diagnostics: DocumentDiagnostic[];
}
export interface IPdfCompiler {
    readonly name: string;
    compile(payload: TypstRenderPayload, context: PdfCompileContext): Promise<PdfCompileResult>;
}
