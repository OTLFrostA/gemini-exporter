import { ensureV2Ready as ensureWorkerReady } from '../background/readiness.js';
import { ensureContentReady } from './contentReady.js';

/** The Worker awaits its shared promise directly; other contexts use its IPC boundary. */
export async function ensureV2Ready(): Promise<void> {
    if (typeof window === 'undefined' && typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
        await ensureWorkerReady();
        return;
    }
    await ensureContentReady();
}
