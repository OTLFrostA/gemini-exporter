// src/ui/controllers/exportController.js - Orchestrates ExportEngine, no direct DOM except callbacks
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ExportController = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';
    let activeEngine = null;
    let exportRunning = false;

    function $(id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; }

    function setRunning(running) {
        exportRunning = !!running;
        const btnExport = $('btnExport');
        const btnCancel = $('btnCancel');
        const btnIncrementalScan = $('btnIncrementalScan');
        const btnDeepScan = $('btnDeepScan');
        const btnImportTakeout = $('btnImportTakeout');
        const btnSetDir = $('btnSetDir');
        const btnClearExported = $('btnClearExported');
        const btnClearAll = $('btnClearAll');
        const banner = $('exportSessionBanner');

        if (btnExport) btnExport.disabled = !!running;
        if (btnCancel) btnCancel.style.display = running ? '' : 'none';
        if (btnIncrementalScan) btnIncrementalScan.disabled = !!running;
        if (btnDeepScan) btnDeepScan.disabled = !!running;
        if (btnImportTakeout) btnImportTakeout.disabled = !!running;
        if (btnSetDir) btnSetDir.disabled = !!running;
        if (btnClearExported) btnClearExported.disabled = !!running;
        if (btnClearAll) btnClearAll.disabled = !!running;

        if (running && banner) {
            banner.style.display = 'none';
        }
        if (!running) {
            const pw = $('progWrap');
            if (pw) pw.style.display = 'none';
        }
    }

    function isRunning() { return exportRunning; }
    function getActiveEngine() { return activeEngine; }

    async function runExport({ selected, format, skip, includeIndex, includeAssets, useZip, dirHandle, currentSlot, conversations, exportedIds, takeoutEngine }, callbacks) {
        setRunning(true);
        const engineClass = (typeof ExportEngine !== 'undefined' && ExportEngine.ExportEngine) ? ExportEngine.ExportEngine : (typeof ExportEngine !== 'undefined' ? ExportEngine : null);
        if (!engineClass) {
            setRunning(false);
            throw new Error('ExportEngine is not loaded');
        }
        activeEngine = new engineClass();
        try {
            const result = await activeEngine.run({ selected, format, skip, includeIndex, includeAssets, useZip, dirHandle, currentSlot, conversations, exportedIds, takeoutEngine }, callbacks);
            return result;
        } finally {
            setRunning(false);
            activeEngine = null;
        }
    }

    function abort() {
        if (activeEngine) activeEngine.abort();
    }

    return { setRunning, isRunning, getActiveEngine, runExport, abort };
}));
