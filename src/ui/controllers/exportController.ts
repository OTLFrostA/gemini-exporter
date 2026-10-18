import type { ExportControllerContract, UIExportOptions, UIExportCallbacks, UIExportResult, ActiveExportEngine } from '../../types/ui.js';
import { runExport as executeExport, type ExportFormat } from '../../core/application/index.js';
import { $, setWorkbenchControlsDisabled } from '../uiCommon.js';
import { conversationKey } from '../../core/domain/conversationKey.js';

let activeEngine: AbortController | null = null;
let exportRunning = false;

export function estimateMemoryUsage(selected: unknown[], _conversations: unknown[]): number {
    // Index no longer contains attachment/message counts. Avoid inventing a resource estimate.
    return Math.round(selected.length * 0.05);
}

export function setRunning(running: boolean): void {
    exportRunning = !!running;
    setWorkbenchControlsDisabled(running);
    const btnCancel = $('btnCancel');
    if (btnCancel) btnCancel.style.display = running ? '' : 'none';
    const banner = $('exportSessionBanner');
    if (running && banner) {
        banner.style.display = 'none';
    }
}

export function isRunning(): boolean {
    return exportRunning;
}

export function getActiveEngine(): ActiveExportEngine | null {
    const controller = activeEngine;
    return controller ? { abort: () => controller.abort() } : null;
}

export function abort(): void {
    activeEngine?.abort();
    // Keep the controls locked until Application has finished cancellation and cleanup.
}

export async function runExport(
    options: UIExportOptions,
    callbacks: UIExportCallbacks
): Promise<UIExportResult> {
    if (exportRunning) throw new Error('Export already running');
    const format = options.format || 'markdown';
    if (!['markdown', 'html', 'json', 'pdf'].includes(format)) throw new Error('Unsupported export format');
    if (!options.accountId) throw new Error('Select an account before exporting');
    const accountId = options.accountId;
    const keys = options.selected.map(item => {
        if (typeof item !== 'string' && item.key && item.key.accountId !== accountId) throw new Error('Selected conversation belongs to another account');
        return conversationKey(accountId, typeof item === 'string' ? item : item.key?.conversationId || item.id);
    });
    activeEngine = new AbortController();
    setRunning(true);
    try {
        const result = await executeExport({ keys, format: format as ExportFormat,
            delivery: options.useZip === false ? 'folderWriter' : 'browserDownload',
            useZip: options.useZip !== false, includeAssets: options.includeAssets !== false,
            skipUnchanged: options.skip === true }, {
            signal: activeEngine.signal,
            onProgress: progress => callbacks.onProgress?.({ ...progress,
                pct: progress.total ? progress.current / progress.total * 100 : 0,
                title: progress.key.conversationId })
        });
        return { exportedCount: result.exported, landedChats: result.exported,
            skipped: result.skipped, partial: result.partial, aborted: result.aborted,
            failedChats: result.failed.map(key => ({ id: key.conversationId, error: 'Export failed' })) };
    } finally {
        activeEngine = null;
        setRunning(false);
    }
}

export const ExportController: ExportControllerContract = {
    setRunning,
    isRunning,
    getActiveEngine,
    runExport,
    abort,
    estimateMemoryUsage
};

export default ExportController;
