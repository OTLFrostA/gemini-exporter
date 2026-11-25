import {
    diagnosticSnapshot,
    serializeErrorForDiagnostic,
    type DiagnosticEventSource,
    type DiagnosticSeverity,
    type RuntimeDiagnosticEvent,
    type RuntimeDiagnosticSnapshot,
} from '../../shared/diagnostics/diagnostic.js';
import { assertExtensionSender, object } from './contentSender.js';

export type { DiagnosticEventSource, RuntimeDiagnosticEvent, RuntimeDiagnosticSnapshot };

const SESSION_KEY = 'gemini_exporter_diag_buffer_v1';
const MAX_EVENTS = 500;
const VALID_SOURCES = new Set<string>(['background', 'content', 'popup', 'options']);
const VALID_SEVERITIES = new Set<string>(['info', 'warning', 'error']);

const swStartedAt = Date.now();
let events: RuntimeDiagnosticEvent[] = [];
let droppedCount = 0;
let loadedFromSession = false;
let loadPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function isValidEvent(value: unknown): value is RuntimeDiagnosticEvent {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const at = Reflect.get(value, 'at');
    const source = Reflect.get(value, 'source');
    const severity = Reflect.get(value, 'severity');
    const code = Reflect.get(value, 'code');
    const message = Reflect.get(value, 'message');
    return typeof at === 'number' && Number.isFinite(at)
        && typeof source === 'string' && VALID_SOURCES.has(source)
        && typeof severity === 'string' && VALID_SEVERITIES.has(severity)
        && typeof code === 'string' && typeof message === 'string';
}

async function ensureLoaded(): Promise<void> {
    if (loadedFromSession) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage?.session?.get) {
                const stored = await chrome.storage.session.get(SESSION_KEY);
                const raw = stored?.[SESSION_KEY];
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                    const persistedEvents = Reflect.get(raw, 'events');
                    const persistedDropped = Reflect.get(raw, 'droppedCount');
                    if (Array.isArray(persistedEvents)) {
                        const valid = persistedEvents.filter(isValidEvent);
                        // Prepend persisted events before any events recorded during boot
                        const merged = [...valid, ...events];
                        if (merged.length > MAX_EVENTS) {
                            droppedCount += merged.length - MAX_EVENTS;
                            events = merged.slice(merged.length - MAX_EVENTS);
                        } else {
                            events = merged;
                        }
                    }
                    if (typeof persistedDropped === 'number' && Number.isSafeInteger(persistedDropped) && persistedDropped > 0) {
                        droppedCount += persistedDropped;
                    }
                }
            }
        } catch {
            /* Session storage may be unavailable in restricted contexts. */
        } finally {
            loadedFromSession = true;
        }
    })();
    return loadPromise;
}

function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        if (typeof chrome === 'undefined' || !chrome.storage?.session?.set) return;
        void chrome.storage.session.set({
            [SESSION_KEY]: { events, droppedCount },
        }).catch(() => { /* Ignore quota or shutdown errors. */ });
    }, 150);
}

export function recordBackgroundDiagnostic(input: {
    source?: DiagnosticEventSource;
    severity: DiagnosticSeverity;
    code: string;
    message: string;
    details?: unknown;
    error?: unknown;
    tabUrl?: string;
}): void {
    const entry: RuntimeDiagnosticEvent = {
        at: Date.now(),
        source: input.source ?? 'background',
        severity: input.severity,
        code: input.code,
        message: input.message.slice(0, 600),
        ...(input.details !== undefined ? { details: diagnosticSnapshot(input.details, { maxDepth: 4, maxKeys: 24, maxArray: 10, maxStringLength: 320 }) } : {}),
        ...(input.error !== undefined ? { error: serializeErrorForDiagnostic(input.error) } : {}),
        ...(input.tabUrl ? { tabUrl: input.tabUrl.slice(0, 300) } : {}),
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) {
        events.shift();
        droppedCount++;
    }
    scheduleFlush();
}

export function initBackgroundDiagnosticCapture(): void {
    void ensureLoaded();
    if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
        self.addEventListener('error', (event: ErrorEvent) => {
            recordBackgroundDiagnostic({
                source: 'background',
                severity: 'error',
                code: 'SW_UNCAUGHT_ERROR',
                message: event.message || 'Uncaught Service Worker error',
                error: event.error ?? event.message,
                details: { filename: event.filename, lineno: event.lineno, colno: event.colno },
            });
        });
        self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
            recordBackgroundDiagnostic({
                source: 'background',
                severity: 'error',
                code: 'SW_UNHANDLED_REJECTION',
                message: event.reason instanceof Error ? event.reason.message : String(event.reason),
                error: event.reason,
            });
        });
    }
}

async function getDiagnosticBufferSnapshot(): Promise<RuntimeDiagnosticSnapshot> {
    await ensureLoaded();
    return {
        swStartedAt,
        droppedCount,
        events: [...events],
    };
}

export function handleDiagnosticMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (value: unknown) => void,
): boolean {
    if (!message || typeof message !== 'object' || !('action' in message)) return false;
    const action = Reflect.get(message, 'action');
    if (action !== 'recordDiagnosticEvent' && action !== 'getDiagnosticSnapshot') return false;
    void (async () => {
        try {
            assertExtensionSender(sender);
            if (action === 'recordDiagnosticEvent') {
                const req = object(message);
                const rawSource = typeof req.source === 'string' && VALID_SOURCES.has(req.source)
                    ? req.source as DiagnosticEventSource
                    : (sender.tab ? 'content' : 'options');
                const rawSeverity = typeof req.severity === 'string' && VALID_SEVERITIES.has(req.severity)
                    ? req.severity as DiagnosticSeverity
                    : 'info';
                const code = typeof req.code === 'string' && req.code ? req.code.slice(0, 120) : 'RUNTIME_EVENT';
                const msg = typeof req.message === 'string' ? req.message : String(req.message ?? '');
                recordBackgroundDiagnostic({
                    source: rawSource,
                    severity: rawSeverity,
                    code,
                    message: msg,
                    ...(req.details !== undefined ? { details: req.details } : {}),
                    ...(req.error !== undefined ? { error: req.error } : {}),
                    ...(typeof sender.tab?.url === 'string' ? { tabUrl: sender.tab.url } : {}),
                });
                respond({ ok: true });
                return;
            }
            // Only extension pages (Options/Popup) may read the full diagnostic snapshot.
            const extOrigin = typeof chrome.runtime?.getURL === 'function'
                ? chrome.runtime.getURL('')
                : `chrome-extension://${chrome.runtime.id}/`;
            if (sender.tab && !(typeof sender.url === 'string' && sender.url.startsWith(extOrigin))) {
                throw new Error('Extension page required for diagnostic snapshot');
            }
            const snapshot = await getDiagnosticBufferSnapshot();
            respond({ ok: true, snapshot });
        } catch (error) {
            respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    })();
    return true;
}
