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

    function startIncrementalScan(slot, { onStart, onProgress, onLog, onFinished, onError } = {}) {
        if (scanRunning) return;
        setScanRunning(true);
        if (onStart) onStart();

        chrome.runtime.sendMessage({ action: 'deepScan', mode: 'incremental', accountSlot: slot || 'u0' }, (res) => {
            setScanRunning(false);

            if (chrome.runtime.lastError) {
                const err = chrome.runtime.lastError.message;
                const errMsg = typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `增量同步失败: ${err}`;
                if (onLog) onLog(errMsg, 'error');
                if (onError) onError(new Error(err), errMsg);
                return;
            }
            if (res && res.success) {
                const count = res.count || res.total || 0;
                const finishMsg = typeof I18n !== 'undefined' ? I18n.t('syncFinished', count) : `增量同步完成，共 ${count} 条`;
                if (onLog) onLog(finishMsg, 'info');
                if (onFinished) onFinished({ count, res, message: finishMsg });
            } else {
                const err = (res && res.error) || '未知错误';
                const errMsg = typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `同步失败: ${err}`;
                if (onLog) onLog(errMsg, 'error');
                if (onError) onError(new Error(err), errMsg);
            }
        });
    }

    function startDeepScan(slot, { onStart, onProgress, onLog, onFinished, onError } = {}) {
        if (scanRunning) return;
        setScanRunning(true);
        if (onStart) onStart();

        chrome.runtime.sendMessage({ action: 'deepScan', mode: 'full', accountSlot: slot || 'u0' }, (res) => {
            setScanRunning(false);

            if (chrome.runtime.lastError) {
                const err = chrome.runtime.lastError.message;
                const errMsg = typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `全量扫描失败: ${err}`;
                if (onLog) onLog(errMsg, 'error');
                if (onError) onError(new Error(err), errMsg);
                return;
            }
            if (res && res.success) {
                const count = res.count || res.total || 0;
                const finishMsg = typeof I18n !== 'undefined' ? I18n.t('deepSyncFinished', count) : `全量拉取完成，共 ${count} 条`;
                if (onLog) onLog(finishMsg, 'info');
                if (onFinished) onFinished({ count, res, message: finishMsg });
            } else {
                const err = (res && res.error) || '未知错误';
                const errMsg = typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `全量拉取失败: ${err}`;
                if (onLog) onLog(errMsg, 'error');
                if (onError) onError(new Error(err), errMsg);
            }
        });
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
