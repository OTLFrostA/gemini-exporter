import type { JsonValue } from '../utils/jsonTypes.js';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';
export type DiagnosticEventSource = 'background' | 'content' | 'popup' | 'options';

export interface RuntimeDiagnosticEvent {
    at: number;
    source: DiagnosticEventSource;
    severity: DiagnosticSeverity;
    code: string;
    message: string;
    details?: JsonValue;
    error?: JsonValue;
    tabUrl?: string;
}

export interface RuntimeDiagnosticSnapshot {
    swStartedAt: number;
    droppedCount: number;
    events: RuntimeDiagnosticEvent[];
}
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

interface DiagnosticSnapshotOptions {
    maxDepth?: number;
    maxKeys?: number;
    maxArray?: number;
    maxStringLength?: number;
}

const SENSITIVE_KEY_PATTERN = /^(authorization|cookie|set-cookie|x-csrf-token|csrf[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|id[_-]?token|api[_-]?key|secret|password|snlm0e)$/i;

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

/** Describe a locator without retaining its path, query, fragment or credentials. */
export function diagnosticUrlShape(uri: string) {
    let scheme: string | null = null;
    try { scheme = new URL(uri).protocol; } catch { /* Relative or malformed locator. */ }
    return { kind: scheme ? 'absolute' : uri.startsWith('//') ? 'network_relative'
        : uri.startsWith('/') ? 'root_relative' : 'relative_or_invalid',
        scheme, length: uri.length, surroundingWhitespace: uri !== uri.trim() };
}

/** Capture a rich, bounded, JSON-safe snapshot of wire/runtime payloads for offline diagnosis. */
export function diagnosticSnapshot(value: unknown, options: DiagnosticSnapshotOptions = {}): JsonValue {
    const maxDepth = options.maxDepth ?? 5;
    const maxKeys = options.maxKeys ?? 32;
    const maxArray = options.maxArray ?? 12;
    const maxStringLength = options.maxStringLength ?? 400;
    const seen = new WeakSet<object>();

    const walk = (current: unknown, depth: number): JsonValue => {
        if (current === null) return null;
        if (current === undefined) return '<undefined>';
        if (typeof current === 'boolean') return current;
        if (typeof current === 'number') return Number.isFinite(current) ? current : String(current);
        if (typeof current === 'bigint') return `<BigInt ${current.toString()}>`;
        if (typeof current === 'symbol') return `<Symbol ${String(current.description ?? '')}>`;
        if (typeof current === 'function') return `<Function ${current.name || 'anonymous'}>`;
        if (typeof current === 'string') {
            if (current.length <= maxStringLength) return current;
            return `${current.slice(0, maxStringLength)}... [truncated, total ${current.length} chars]`;
        }
        if (current instanceof Error) return serializeErrorForDiagnostic(current);
        if (current instanceof Uint8Array) return `<Uint8Array byteLength=${current.byteLength}>`;
        if (ArrayBuffer.isView(current)) return `<ArrayBufferView byteLength=${current.byteLength}>`;
        if (current instanceof ArrayBuffer) return `<ArrayBuffer byteLength=${current.byteLength}>`;
        if (current instanceof Date) return Number.isNaN(current.getTime()) ? '<Invalid Date>' : current.toISOString();
        if (current instanceof RegExp) return current.toString();

        if (typeof current === 'object') {
            if (seen.has(current)) return '<Circular>';
            if (depth >= maxDepth) {
                if (Array.isArray(current)) return `<Array length=${current.length}>`;
                if (current instanceof Map) return `<Map size=${current.size}>`;
                if (current instanceof Set) return `<Set size=${current.size}>`;
                return `<Object keys=${Object.keys(current).length}>`;
            }
            seen.add(current);
            if (Array.isArray(current)) {
                const items: JsonValue[] = [];
                const limit = Math.min(current.length, maxArray);
                for (let i = 0; i < limit; i++) items.push(walk(current[i], depth + 1));
                if (current.length > maxArray) items.push(`... (+${current.length - maxArray} more items)`);
                return items;
            }
            if (current instanceof Map) {
                const entries: JsonValue[] = [];
                let count = 0;
                for (const [k, v] of current.entries()) {
                    if (count >= maxArray) { entries.push(`... (+${current.size - maxArray} more entries)`); break; }
                    entries.push([walk(k, depth + 1), walk(v, depth + 1)]);
                    count++;
                }
                return { __type: 'Map', size: current.size, entries };
            }
            if (current instanceof Set) {
                const items: JsonValue[] = [];
                let count = 0;
                for (const v of current.values()) {
                    if (count >= maxArray) { items.push(`... (+${current.size - maxArray} more items)`); break; }
                    items.push(walk(v, depth + 1));
                    count++;
                }
                return { __type: 'Set', size: current.size, items };
            }
            const out: { [key: string]: JsonValue } = {};
            const keys = Object.keys(current);
            const limit = Math.min(keys.length, maxKeys);
            for (let i = 0; i < limit; i++) {
                const key = keys[i];
                if (SENSITIVE_KEY_PATTERN.test(key)) {
                    out[key] = '<redacted-credential>';
                    continue;
                }
                const fieldValue = Reflect.get(current, key);
                if (fieldValue !== undefined) out[key] = walk(fieldValue, depth + 1);
            }
            if (keys.length > maxKeys) out.__truncatedKeys = keys.length - maxKeys;
            return out;
        }
        return String(current);
    };

    return walk(value, 0);
}

/** Serialize an Error (including OperationError code, details, stack, and cause chain) into JsonValue. */
export function serializeErrorForDiagnostic(error: unknown, maxCauseDepth = 3): JsonValue {
    if (!(error instanceof Error)) {
        return { name: typeof error, message: String(error) };
    }
    const record: { [key: string]: JsonValue } = {
        name: error.name || 'Error',
        message: error.message || '',
    };
    const code = Reflect.get(error, 'code');
    if (typeof code === 'string' && code) record.code = code;
    const httpStatus = Reflect.get(error, 'httpStatus') ?? Reflect.get(error, 'status');
    if (typeof httpStatus === 'number' && Number.isFinite(httpStatus)) record.httpStatus = httpStatus;
    const details = Reflect.get(error, 'details');
    if (details !== undefined) record.details = diagnosticSnapshot(details, { maxDepth: 3, maxKeys: 16, maxArray: 8, maxStringLength: 240 });
    if (typeof error.stack === 'string' && error.stack) {
        const lines = error.stack.split('\n').slice(0, 16);
        record.stack = lines.join('\n');
    }
    const cause = Reflect.get(error, 'cause');
    if (cause !== undefined && maxCauseDepth > 0) {
        record.cause = serializeErrorForDiagnostic(cause, maxCauseDepth - 1);
    }
    return record;
}
