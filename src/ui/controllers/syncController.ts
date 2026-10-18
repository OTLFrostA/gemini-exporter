import type { SyncControllerContract, ScanCallbacks, StopScanCallbacks } from '../../types/ui.js';
import { scanAll } from '../../core/application/index.js';
import { isRateLimited } from '../../core/engine/export/rateLimiter.js';
import { $, t, hasI18n, setWorkbenchControlsDisabled } from '../uiCommon.js';

import { getErrorMessage } from '../../core/utils/messaging.js';

let scanRunning = false;

export function isScanning(): boolean {
    return scanRunning;
}

export function setScanRunning(running: boolean): void {
    scanRunning = !!running;
    setWorkbenchControlsDisabled(running);
    const btnStop = $('btnStopScan');
    if (btnStop) btnStop.style.display = running ? 'inline-flex' : 'none';
}

function isConnectionError(err: string): boolean {
    const str = String(err || '');
    return str.includes('Receiving end does not exist') || str.includes('Could not establish connection');
}

export function formatSyncErrorMessage(err: string): string {
    const errStr = String(err || '');
    if (isConnectionError(errStr)) {
        const refreshHint = hasI18n() ? t('syncConnectionFailedRefresh') : '未能与 Gemini 建立连接，请刷新 gemini.google.com 页面后重试';
        return hasI18n() ? t('syncFailed', refreshHint) : `同步失败: ${refreshHint}`;
    }
    return hasI18n() ? t('syncFailed', errStr) : `同步失败: ${errStr}`;
}

// Detects HTTP 429 rate limits, quota exhaustion, and Google server limits via unified rateLimiter.
export function isServerRateOrQuotaLimit(text?: string | null): boolean {
    return isRateLimited(text);
}

let cancellation: AbortController | null = null;

export function startSync(slot: string, callbacks: ScanCallbacks = {}): void {
    if (scanRunning) return;
    cancellation = new AbortController();
    setScanRunning(true);
    callbacks.onStart?.();
    void scanAll({ accountId: slot }, {
        signal: cancellation.signal,
        onProgress: progress => callbacks.onProgress?.(0,
            `${progress.pagesFetched} pages · ${progress.conversationsFetched} conversations`)
    }).then(result => {
        const hitGoogleLimit = result.status === 'partial_limit' && result.reason === 'provider_limit';
        const success = result.status === 'complete' || result.status === 'up_to_date';
        const count = result.conversationsFetched;
        const res = { ...result, success, count, error: result.reason, hitGoogleLimit };
        const message = t(success ? (result.status === 'up_to_date' ? 'syncUpToDate' : 'syncFinished')
            : result.status === 'aborted' ? 'syncAbortedSaved' : 'syncIncompleteSaved', count, result.reason || '');
        callbacks.onLog?.(message, success ? 'info' : 'warn');
        if (success) callbacks.onFinished?.({ count, res, message, hitGoogleLimit });
        else callbacks.onError?.(new Error(result.reason || result.status), message, { hitGoogleLimit, res });
    }).catch((error: unknown) => {
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)), formatSyncErrorMessage(getErrorMessage(error)));
    }).finally(() => {
        cancellation = null;
        setScanRunning(false);
    });
}

export function stopScan(_slot: string, callbacks: StopScanCallbacks = {}): void {
    cancellation?.abort();
    const message = t('stoppingSync');
    callbacks.onLog?.(message, 'warn');
    callbacks.onStopped?.({ message });
}

export const SyncController: SyncControllerContract & { formatSyncErrorMessage?: (err: string) => string } = {
    isScanning,
    setScanRunning,
    startSync,
    stopScan,
    formatSyncErrorMessage
};

export default SyncController;
