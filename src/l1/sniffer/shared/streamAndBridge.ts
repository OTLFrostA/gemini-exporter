import { isRecord } from '../../../shared/utils/typeGuards.js';

/** Stream line-by-line from a cloned fetch Response body with a strict byte ceiling.
 * Always flushes any trailing line on EOF and releases/cancels the reader lock safely.
 */
export async function readCappedStreamLines(
    body: ReadableStream<Uint8Array> | null | undefined,
    maxBytes: number,
    onLine: (line: string) => boolean,
): Promise<boolean> {
    const reader = body?.getReader();
    if (!reader) return false;
    const decoder = new TextDecoder();
    let pending = '';
    let bytes = 0;
    let stopEarly = false;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) {
                pending += decoder.decode();
                if (pending) stopEarly = onLine(pending) || stopEarly;
                return stopEarly;
            }
            bytes += value.byteLength;
            if (bytes > maxBytes) {
                void reader.cancel().catch(() => {});
                return false;
            }
            pending += decoder.decode(value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines) {
                if (onLine(line)) {
                    stopEarly = true;
                    break;
                }
            }
            if (stopEarly) {
                void reader.cancel().catch(() => {});
                return true;
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/** Read a cloned fetch Response body as UTF-8 text up to maxBytes (returning null if exceeded or missing). */
export async function readCappedStreamText(
    body: ReadableStream<Uint8Array> | null | undefined,
    maxBytes: number,
): Promise<string | null> {
    const reader = body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    let exceeded = false;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) {
                exceeded = true;
                break;
            }
            text += decoder.decode(value, { stream: true });
        }
        if (exceeded) return null;
        return text + decoder.decode();
    } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/** Register an origin-locked, serialized window.postMessage consumer for a specific MAIN-world event type. */
export function registerSerializedWindowBridge(options: {
    eventType: string;
    label: string;
    handlePayload: (payload: Record<string, unknown>) => Promise<void>;
    registerCleanup: (cleanup: () => void) => void;
    enqueue?: (work: () => Promise<void>) => Promise<unknown>;
}): void {
    let internalQueue = Promise.resolve();
    const runSerial = options.enqueue ?? ((work: () => Promise<void>) => {
        internalQueue = internalQueue.catch(() => {}).then(work);
        return internalQueue;
    });
    const receive = (event: MessageEvent<unknown>) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (!isRecord(data) || data.type !== options.eventType || !isRecord(data.payload)) return;
        const payload = data.payload;
        void runSerial(() => options.handlePayload(payload))
            .catch(error => console.warn(`[${options.label}]`, error));
    };
    window.addEventListener('message', receive);
    options.registerCleanup(() => window.removeEventListener('message', receive));
}
