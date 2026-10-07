import type { JsonValue } from '../utils/jsonTypes.js';
import type { SourceRef } from './sourceRef.js';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export interface Diagnostic {
    id: string;
    severity: DiagnosticSeverity;
    code: string;
    message: string;
    path?: string;
    sourceRef?: SourceRef;
    details?: JsonValue;
}
