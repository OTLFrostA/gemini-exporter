// src/ui/controllers/syncController.ts - Synchronization & Background Scanning Controller
import type { SyncControllerContract } from '../../types/ui.js';
import GeminiProtocol, { LIMITS } from '../../core/protocol/protocol.js';

const t = (key: string, ...args: any[]): string => {
    if (typeof I18n !== 'undefined' && I18n.t) {
        return I18n.t(key, ...args);
    }
    return key;
};

let scanRunning = false;

function $(id: string): HTMLElement | null {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

export function isScanning(): boolean {
    return scanRunning;
}

export function setScanRunning(running: boolean): void {
    scanRunning = !!running;
    const btnInc = $('btnIncrementalScan') as HTMLButtonElement | null;
    const btnDeep = $('btnDeepScan') as HTMLButtonElement | null;
    const btnStop = $('btnStopScan');
    const btnExport = $('btnExport') as HTMLButtonElement | null;
    const btnImport = $('btnImportTakeout') as HTMLButtonElement | null;
    const btnSetDir = $('btnSetDir') as HTMLButtonElement | null;
    const btnClearExp = $('btnClearExported') as HTMLButtonElement | null;
    const btnClearAll = $('btnClearAll') as HTMLButtonElement | null;

    if (btnInc) btnInc.disabled = !!running;
    if (btnDeep) btnDeep.disabled = !!running;
    if (btnStop) btnStop.style.display = running ? 'inline-flex' : 'none';
    if (btnExport) btnExport.disabled = !!running;
    if (btnImport) btnImport.disabled = !!running;
    if (btnSetDir) btnSetDir.disabled = !!running;
    if (btnClearExp) btnClearExp.disabled = !!running;
    if (btnClearAll) btnClearAll.disabled = !!running;
}

function _runScan(
    mode: 'incremental' | 'full',
    slot: string,
    { onStart, onProgress, onLog, onFinished, onError }: any = {},
    i18nKey: string,
    fallbackMsgFn: (count: number) => string
): void {
    if (scanRunning) return;
    setScanRunning(true);
    if (onStart) onStart();

    chrome.runtime.sendMessage({ action: 'deepScan', mode, accountSlot: slot || 'u0' }, (res: any) => {
        setScanRunning(false);

        if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message;
            const errMsg = typeof t === 'function' ? t('syncFailed', err) : `同步失败: ${err}`;
            if (onLog) onLog(errMsg, 'error');
            if (onError) onError(new Error(err), errMsg);
            return;
        }

        const slidingLimit = (typeof GeminiProtocol !== 'undefined' && GeminiProtocol.LIMITS?.SLIDING_WINDOW) || 500;
        const hitGoogleLimit = !!(
            res?.hitGoogleLimit ||
            res?.diagnostics?.hitGoogleLimit ||
            (mode === 'full' && ((res?.count >= slidingLimit) || (res?.total >= slidingLimit))) ||
            (res?.diagnostics?.stopReason && (
                res.diagnostics.stopReason.includes('BardErrorInfo') ||
                res.diagnostics.stopReason.includes('服务端上限') ||
                res.diagnostics.stopReason.includes(GeminiProtocol?.LIMITS?.SERVER_LIMIT_TEXT || '') ||
                res.diagnostics.stopReason.includes('1096') ||
                res.diagnostics.stopReason.includes('429') ||
                /quota|rate\s*limit|resource_exhausted/i.test(res.diagnostics.stopReason)
            )) ||
            (res?.error && (
                String(res.error).includes('BardErrorInfo') ||
                String(res.error).includes('1096') ||
                String(res.error).includes('429') ||
                /quota|rate\s*limit|resource_exhausted|too\s*many\s*requests/i.test(String(res.error))
            ))
        );

        if (res && res.success) {
            const count = res.count || res.total || 0;
            const finishMsg = typeof t === 'function' ? t(i18nKey, count) : fallbackMsgFn(count);
            if (onLog) onLog(finishMsg, 'info');
            if (onFinished) onFinished({ count, res, message: finishMsg, hitGoogleLimit });
        } else {
            const err = (res && res.error) || '未知错误';
            const errMsg = typeof t === 'function' ? t('syncFailed', err) : `同步失败: ${err}`;
            if (onLog) onLog(errMsg, 'error');
            if (onError) onError(new Error(err), errMsg, { hitGoogleLimit, res });
        }
    });
}

export function startIncrementalScan(slot: string, callbacks: any = {}): void {
    _runScan('incremental', slot, callbacks, 'syncFinished', count => `增量同步完成，共 ${count} 条`);
}

export function startDeepScan(slot: string, callbacks: any = {}): void {
    _runScan('full', slot, callbacks, 'deepSyncFinished', count => `全量拉取完成，共 ${count} 条`);
}

export function stopScan(slot: string, { onStopped, onLog }: any = {}): void {
    chrome.runtime.sendMessage({ action: 'stopDeepScan', accountSlot: slot || 'u0' }, () => {
        const stopMsg = typeof t === 'function' ? t('stoppingSync') : '正在终止同步...';
        if (onLog) onLog(stopMsg, 'warn');
        setScanRunning(false);
        if (onStopped) onStopped({ message: stopMsg });
    });
}

export const SyncController: SyncControllerContract = {
    isScanning,
    setScanRunning,
    startIncrementalScan,
    startDeepScan,
    stopScan
};

(SyncController as any).SyncController = SyncController;
(SyncController as any).default = SyncController;

if (typeof globalThis !== 'undefined') {
    (globalThis as any).SyncController = SyncController;
}
if (typeof module === 'object' && module.exports) {
    module.exports = SyncController;
}

export default SyncController;
