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
