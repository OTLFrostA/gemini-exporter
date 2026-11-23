import { ensureContentReady } from './contentReady.js';

type GlobalWithWorkerReadiness = typeof globalThis & {
    __gemExporterWorkerReadiness?: () => Promise<void>;
};

let workerReadyResolver: (() => Promise<void>) | undefined;

export function provideWorkerReadiness(resolver: () => Promise<void>): void {
    workerReadyResolver = resolver;
    (globalThis as GlobalWithWorkerReadiness).__gemExporterWorkerReadiness = resolver;
}

/** The Worker awaits its shared promise directly; other contexts use its IPC boundary. */
export async function ensureV2Ready(): Promise<void> {
    const resolver = workerReadyResolver ?? (globalThis as GlobalWithWorkerReadiness).__gemExporterWorkerReadiness;
    if (resolver && typeof window === 'undefined' && typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
        await resolver();
        return;
    }
    await ensureContentReady();
}


