import type { SyncControllerContract, ScanCallbacks, StopScanCallbacks } from '../../types/ui.js';
import type { DeepScanMessage, StopDeepScanMessage } from '../../types/messages.js';
import { isRateLimited } from '../../core/engine/export/rateLimiter.js';
import { $, t, hasI18n, setWorkbenchControlsDisabled } from '../uiCommon.js';
import { isScanResponse } from '../../core/utils/messageResponses.js';
import { sendTypedMessage, getErrorMessage } from '../../core/utils/messaging.js';

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

function _runScan(
    slot: string,
    { onStart, onProgress, onLog, onFinished, onError }: ScanCallbacks = {},
): void {
    if (scanRunning) return;
    setScanRunning(true);
    if (onStart) onStart();

    // Allow the background tab request to expire before releasing the UI lock.
    const uiTimeoutMs = 330000;
    const msg: DeepScanMessage = { action: 'deepScan', accountSlot: slot || 'u0' };
    sendTypedMessage(msg, uiTimeoutMs).then((raw: unknown) => {
        if (!isScanResponse(raw)) throw new Error('Gemini returned unreadable sync data. Refresh its page and try again.');
        const res = raw;
        setScanRunning(false);

        const hitGoogleLimit = !!(
            res?.hitGoogleLimit ||
            res?.diagnostics?.hitGoogleLimit
        );

        if (res.status && res.status !== 'complete' && res.status !== 'up_to_date') {
            const count = res.count ?? res.total ?? 0;
            const key = res.status === 'partial_limit' ? 'syncFinishedWithLimit'
                : res.status === 'aborted' ? 'syncAbortedSaved' : 'syncIncompleteSaved';
            const finishMsg = t(key, count, res.error || res.diagnostics?.stopReason || '');
            if (onLog) onLog(finishMsg, 'warn');
            if (onError) onError(new Error(res.error || res.status), finishMsg, { hitGoogleLimit, res });
        } else if (res && res.success) {
            const count = res.count || res.total || 0;
            let finishMsg: string;
            if (hitGoogleLimit) {
                finishMsg = typeof t === 'function'
                    ? t('syncFinishedWithLimit', count)
                    : `已拉取约 ${count} 条会话（已达 Google 网页端上限），更早记录建议使用 Google Takeout 导入补全。`;
            } else {
                finishMsg = typeof t === 'function' ? t('syncFinished', count) : `同步完成，共 ${count} 条`;
            }
            if (onLog) onLog(finishMsg, 'info');
            if (onFinished) onFinished({ count, res, message: finishMsg, hitGoogleLimit });
        } else {
            const err = (res && res.error) || '未知错误';
            const errMsg = formatSyncErrorMessage(err);
            if (onLog) onLog(errMsg, 'error');
            if (onError) onError(new Error(err), errMsg, { hitGoogleLimit, res });
        }
    }).catch((err: unknown) => {
        setScanRunning(false);
        const errMsg = formatSyncErrorMessage(getErrorMessage(err));
        if (onLog) onLog(errMsg, 'error');
        if (onError) onError(err instanceof Error ? err : new Error(String(err)), errMsg);
    });
}

export function startSync(slot: string, callbacks: ScanCallbacks = {}): void {
    _runScan(slot, callbacks);
}

export function stopScan(slot: string, { onStopped, onLog }: StopScanCallbacks = {}): void {
    const msg: StopDeepScanMessage = { action: 'stopDeepScan', accountSlot: slot || 'u0' };
    chrome.runtime.sendMessage(msg, () => {
        const stopMsg = typeof t === 'function' ? t('stoppingSync') : '正在终止同步...';
        if (onLog) onLog(stopMsg, 'warn');
        setScanRunning(false);
        if (onStopped) onStopped({ message: stopMsg });
    });
}

export const SyncController: SyncControllerContract & { formatSyncErrorMessage?: (err: string) => string } = {
    isScanning,
    setScanRunning,
    startSync,
    stopScan,
    formatSyncErrorMessage
};

export default SyncController;
