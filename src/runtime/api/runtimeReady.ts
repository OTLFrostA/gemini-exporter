import { ensureContentReady } from './contentReady.js';

let workerReadyResolver: (() => Promise<void>) | undefined;

export function provideWorkerReadiness(resolver: () => Promise<void>): void {
    workerReadyResolver = resolver;
}

/** The Worker awaits its shared promise directly; other contexts use its IPC boundary. */
export async function ensureV2Ready(): Promise<void> {
    if (workerReadyResolver && typeof window === 'undefined' && typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
        await workerReadyResolver();
        return;
    }
    await ensureContentReady();
}

