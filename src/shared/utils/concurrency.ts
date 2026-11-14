/**
 * Abort-aware bounded concurrency primitives shared across Application and L1 providers.
 */
export interface Semaphore {
    acquire(signal?: AbortSignal): Promise<() => void>;
    run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

interface Waiter {
    grant: (release: () => void) => void;
    cancel: () => void;
}

export function createSemaphore(limit: number): Semaphore {
    const capacity = Math.max(1, Math.trunc(limit));
    let active = 0;
    const queue: Waiter[] = [];

    const releaseOne = (): void => {
        while (queue.length > 0) {
            const next = queue.shift();
            if (!next) break;
            let released = false;
            next.grant(() => {
                if (released) return;
                released = true;
                releaseOne();
            });
            return;
        }
        active = Math.max(0, active - 1);
    };

    const acquire = (signal?: AbortSignal): Promise<() => void> => {
        signal?.throwIfAborted();
        if (active < capacity) {
            active++;
            let released = false;
            return Promise.resolve(() => {
                if (released) return;
                released = true;
                releaseOne();
            });
        }
        return new Promise<() => void>((resolve, reject) => {
            let settled = false;
            const onAbort = (): void => {
                if (settled) return;
                settled = true;
                const index = queue.indexOf(waiter);
                if (index >= 0) queue.splice(index, 1);
                try {
                    signal?.throwIfAborted();
                    reject(new DOMException('The operation was aborted.', 'AbortError'));
                } catch (error) {
                    reject(error);
                }
            };
            const waiter: Waiter = {
                grant(release) {
                    if (settled) {
                        release();
                        return;
                    }
                    settled = true;
                    signal?.removeEventListener('abort', onAbort);
                    resolve(release);
                },
                cancel: onAbort,
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            queue.push(waiter);
        });
    };

    const run = async <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
        const release = await acquire(signal);
        try {
            return await task();
        } finally {
            release();
        }
    };

    return { acquire, run };
}

/** Map items with bounded concurrency while preserving deterministic input order. */
export async function mapWithConcurrency<Item, Output>(
    items: readonly Item[],
    limit: number,
    mapper: (item: Item, index: number) => Promise<Output>,
    signal?: AbortSignal,
): Promise<Output[]> {
    if (items.length === 0) return [];
    const results = new Array<Output>(items.length);
    let cursor = 0;
    let stopped = false;
    const workerCount = Math.min(Math.max(1, Math.trunc(limit)), items.length);

    const worker = async (): Promise<void> => {
        while (!stopped) {
            signal?.throwIfAborted();
            const current = cursor++;
            if (current >= items.length) return;
            try {
                results[current] = await mapper(items[current], current);
            } catch (error) {
                stopped = true;
                throw error;
            }
        }
    };

    const settled = await Promise.allSettled(Array.from({ length: workerCount }, worker));
    for (const outcome of settled) {
        if (outcome.status === 'rejected') throw outcome.reason;
    }
    return results;
}
