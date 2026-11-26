import type {
    DiagnosticEventSource, DiagnosticSeverity, RuntimeDiagnosticEvent, RuntimeDiagnosticSnapshot,
} from './diagnostic.js';
import { isJsonValue } from '../utils/jsonTypes.js';
import { isRecord } from '../utils/typeGuards.js';

export function isDiagnosticSource(value: unknown): value is DiagnosticEventSource {
    return value === 'background' || value === 'content' || value === 'popup' || value === 'options';
}

export function isDiagnosticSeverity(value: unknown): value is DiagnosticSeverity {
    return value === 'info' || value === 'warning' || value === 'error';
}

function isNonnegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isRuntimeDiagnosticEvent(value: unknown): value is RuntimeDiagnosticEvent {
    return isRecord(value) && isNonnegativeInteger(value.at)
        && isDiagnosticSource(value.source) && isDiagnosticSeverity(value.severity)
        && typeof value.code === 'string' && typeof value.message === 'string'
        && (value.tabUrl === undefined || typeof value.tabUrl === 'string')
        && (value.details === undefined || isJsonValue(value.details))
        && (value.error === undefined || isJsonValue(value.error));
}

export function isRuntimeDiagnosticSnapshot(value: unknown): value is RuntimeDiagnosticSnapshot {
    return isRecord(value) && isNonnegativeInteger(value.swStartedAt) && isNonnegativeInteger(value.droppedCount)
        && Array.isArray(value.events) && value.events.every(isRuntimeDiagnosticEvent);
}
