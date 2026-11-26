import {
    diagnosticSnapshot,
    serializeErrorForDiagnostic,
    type DiagnosticEventSource,
    type DiagnosticSeverity,
    type RuntimeDiagnosticSnapshot,
} from '../../shared/diagnostics/diagnostic.js';
import { isRecord } from '../../shared/utils/typeGuards.js';
import { isRuntimeDiagnosticSnapshot } from '../../shared/diagnostics/runtimeDiagnosticSnapshot.js';

export type { DiagnosticEventSource, RuntimeDiagnosticEvent, RuntimeDiagnosticSnapshot } from '../../shared/diagnostics/diagnostic.js';

/** Fire-and-forget cross-context diagnostic event reporting to the Background ring buffer. */
export function reportRuntimeDiagnostic(
    source: DiagnosticEventSource,
    input: {
        severity: DiagnosticSeverity;
        code: string;
        message: string;
        details?: unknown;
        error?: unknown;
    },
): void {
    if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') return;
    try {
        const payload = {
            action: 'recordDiagnosticEvent',
            source,
            severity: input.severity,
            code: input.code,
            message: input.message,
            ...(input.details !== undefined ? { details: diagnosticSnapshot(input.details, { maxDepth: 4, maxKeys: 24, maxArray: 10, maxStringLength: 320 }) } : {}),
            ...(input.error !== undefined ? { error: serializeErrorForDiagnostic(input.error) } : {}),
        };
        const result: unknown = chrome.runtime.sendMessage(payload);
        if (result && typeof result === 'object' && 'catch' in result && typeof result.catch === 'function') {
            (result as Promise<unknown>).catch(() => { /* Never disrupt caller if SW is unavailable. */ });
        }
    } catch {
        /* Extension context may be invalidated during reload. */
    }
}

/** Capture uncaught window errors and unhandled rejections into the Background diagnostic ring buffer. */
export function installGlobalErrorDiagnosticCapture(source: 'popup' | 'options' | 'content'): void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    window.addEventListener('error', (event: ErrorEvent) => {
        reportRuntimeDiagnostic(source, {
            severity: 'error',
            code: `${source.toUpperCase()}_UNCAUGHT_ERROR`,
            message: event.message || `Uncaught ${source} error`,
            error: event.error ?? event.message,
            details: { filename: event.filename, lineno: event.lineno, colno: event.colno },
        });
    });
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        reportRuntimeDiagnostic(source, {
            severity: 'error',
            code: `${source.toUpperCase()}_UNHANDLED_REJECTION`,
            message: event.reason instanceof Error ? event.reason.message : String(event.reason),
            error: event.reason,
        });
    });
}

/** Pull the full cross-context Background diagnostic ring buffer for Options export. */
export async function fetchRuntimeDiagnosticSnapshot(): Promise<RuntimeDiagnosticSnapshot | null> {
    if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') return null;
    try {
        const response: unknown = await chrome.runtime.sendMessage({ action: 'getDiagnosticSnapshot' });
        if (!isRecord(response) || response.ok !== true) return null;
        return isRuntimeDiagnosticSnapshot(response.snapshot) ? response.snapshot : null;
    } catch {
        return null;
    }
}
