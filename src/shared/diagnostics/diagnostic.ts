import type { JsonValue } from '../utils/jsonTypes.js';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export interface SourceRef {
    providerId: string;
    providerMessageId?: string;
    locator?: string;
    rawRef?: string;
}

/** Observations for logs and reports. Business outcomes must never be inferred from these records. */
export interface Diagnostic {
    severity: DiagnosticSeverity;
    code: string;
    message: string;
    path?: string;
    id?: string;
    sourceRef?: SourceRef;
    details?: JsonValue;
}

/** Diagnostic observers must never change acquisition or admission outcomes. */
export function emitDiagnostic(observer: ((diagnostic: Diagnostic) => void) | undefined, diagnostic: Diagnostic): void {
    try { observer?.(diagnostic); }
    catch (error) { console.warn('[Gemini Exporter] Diagnostic listener failed', error); }
}

/** Keep request routing evidence without signed paths, query parameters or credentials. */
export function diagnosticOrigin(uri: string): string | null {
    try { return new URL(uri).origin; }
    catch { return null; }
}
