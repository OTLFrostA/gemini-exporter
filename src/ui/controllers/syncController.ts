import { scanAll } from '../../core/application/sync/scanController.js';
import type { ScanProgress, ScanResult } from '../../core/application/sync/scanController.js';
import * as Runtime from '../../core/utils/tabService.js';

/** Consume Runtime's source resolution; never infer source identity in UI. */
export async function startSync(preferredAccountId: string | undefined, options: {
    signal: AbortSignal; forceFull?: boolean;
    onTarget: (id: string) => Promise<void>;
    onProgress?: (progress: ScanProgress) => void;
}, ports = {
    resolveScanTarget: async (preferred?: string): Promise<string> => {
        const runtime = Runtime as typeof Runtime & { resolveScanTarget?: (id?: string) => Promise<string> };
        if (!runtime.resolveScanTarget) throw new Error('Runtime resolveScanTarget unavailable. Open/login/refresh Gemini, then retry.');
        return runtime.resolveScanTarget(preferred);
    }, scanAll
}): Promise<ScanResult> {
    const accountId = await ports.resolveScanTarget(preferredAccountId);
    options.signal.throwIfAborted();
    await options.onTarget(accountId);
    options.signal.throwIfAborted();
    return ports.scanAll({ accountId, ...(options.forceFull ? { forceFull: true } : {}) },
        { signal: options.signal, onProgress: options.onProgress });
}
