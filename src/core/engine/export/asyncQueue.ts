// src/core/engine/export/asyncQueue.ts - Abort-aware async task queue.
// Split out of exportOrchestrator.ts (P1: god-file decomposition).
// Leaf module: no engine imports, no cycles.

export class AsyncQueue {
    _queue: any[];
    _waiters: ((task: any) => void)[];
    _closed: boolean;

    constructor() {
        this._queue = [];
        this._waiters = [];
        this._closed = false;
    }

    push(task: any): void {
        if (this._closed) return;
        if (this._waiters.length > 0) {
            const waiter = this._waiters.shift()!;
            waiter(task);
        } else {
            this._queue.push(task);
        }
    }

    async pop(abortSignal?: AbortSignal | null): Promise<any> {
        if (this._queue.length > 0) {
            return this._queue.shift();
        }
        if (this._closed) return null;
        return new Promise((resolve) => {
            let onAbort: any = null;
            const waiter = (task: any) => {
                if (onAbort && abortSignal) {
                    try { abortSignal.removeEventListener('abort', onAbort); } catch (_) { /* intentional */ }
                }
                resolve(task);
            };
            if (abortSignal) {
                onAbort = () => {
                    const idx = this._waiters.indexOf(waiter);
                    if (idx !== -1) this._waiters.splice(idx, 1);
                    resolve(null);
                };
                if (abortSignal.aborted) return resolve(null);
                try { abortSignal.addEventListener('abort', onAbort, { once: true }); } catch (e) {
                    if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:asyncQueue.ts]', e);
                }
            }
            this._waiters.push(waiter);
        });
    }

    close(): void {
        this._closed = true;
        while (this._waiters.length > 0) {
            const waiter = this._waiters.shift()!;
            waiter(null);
        }
    }

    get length(): number {
        return this._queue.length;
    }
}

export default AsyncQueue;
