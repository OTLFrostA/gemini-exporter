// src/ui/controllers/syncController.js - Synchronization & Background Scanning Controller
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SyncController = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    let scanRunning = false;

    function $(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    function isScanning() {
        return scanRunning;
    }

    function setScanRunning(running) {
        scanRunning = !!running;
        if ($('btnIncrementalScan')) $('btnIncrementalScan').disabled = !!running;
        if ($('btnDeepScan')) $('btnDeepScan').disabled = !!running;
        if ($('btnStopScan')) $('btnStopScan').style.display = running ? 'inline-flex' : 'none';
        if ($('btnExport')) $('btnExport').disabled = !!running;
        if ($('btnImportTakeout')) $('btnImportTakeout').disabled = !!running;
        if ($('btnSetDir')) $('btnSetDir').disabled = !!running;
        if ($('btnClearExported')) $('btnClearExported').disabled = !!running;
        if ($('btnClearAll')) $('btnClearAll').disabled = !!running;
    }

    function _runScan(mode, slot, { onStart, onProgress, onLog, onFinished, onError } = {}, i18nKey, fallbackMsgFn) {
        if (scanRunning) return;
        setScanRunning(true);
        if (onStart) onStart();

        chrome.runtime.sendMessage({ action: 'deepScan', mode, accountSlot: slot || 'u0' }, (res) => {
            setScanRunning(false);

            if (chrome.runtime.lastError) {
                const err = chrome.runtime.lastError.message;
                const errMsg = typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `同步失败: ${err}`;
                if (onLog) onLog(errMsg, 'error');
                if (onError) onError(new Error(err), errMsg);
                return;
            }
            const hitGoogleLimit = !!(
                res?.hitGoogleLimit ||
                res?.diagnostics?.hitGoogleLimit ||
                (mode === 'full' && ((res?.count >= 500) || (res?.total >= 500))) ||
                (res?.diagnostics?.stopReason && (
                    res.diagnostics.stopReason.includes('BardErrorInfo') ||
                    res.diagnostics.stopReason.includes('服务端上限') ||
                    res.diagnostics.stopReason.includes('600条') ||
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
                const finishMsg = typeof I18n !== 'undefined' ? I18n.t(i18nKey, count) : fallbackMsgFn(count);
                if (onLog) onLog(finishMsg, 'info');
                if (onFinished) onFinished({ count, res, message: finishMsg, hitGoogleLimit });
            } else {
                const err = (res && res.error) || '未知错误';
                const errMsg = typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `同步失败: ${err}`;
                if (onLog) onLog(errMsg, 'error');
                if (onError) onError(new Error(err), errMsg, { hitGoogleLimit, res });
            }
        });
    }

    function startIncrementalScan(slot, callbacks = {}) {
        _runScan('incremental', slot, callbacks, 'syncFinished', count => `增量同步完成，共 ${count} 条`);
    }

    function startDeepScan(slot, callbacks = {}) {
        _runScan('full', slot, callbacks, 'deepSyncFinished', count => `全量拉取完成，共 ${count} 条`);
    }

    function stopScan(slot, { onStopped, onLog } = {}) {
        chrome.runtime.sendMessage({ action: 'stopDeepScan', accountSlot: slot || 'u0' }, () => {
            const stopMsg = typeof I18n !== 'undefined' ? I18n.t('stoppingSync') : '正在终止同步...';
            if (onLog) onLog(stopMsg, 'warn');
            setScanRunning(false);
            if (onStopped) onStopped({ message: stopMsg });
        });
    }

    return {
        isScanning,
        setScanRunning,
        startIncrementalScan,
        startDeepScan,
        stopScan
    };
}));
