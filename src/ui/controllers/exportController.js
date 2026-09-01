// src/ui/controllers/exportController.js - Orchestrates ExportEngine, no direct DOM except callbacks
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ExportController = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';
    let activeEngine = null;
    let exportRunning = false;

    function setRunning(running){
        exportRunning=!!running;
        const btnExport=document.getElementById('btnExport');
        const btnCancel=document.getElementById('btnCancel');
        if(btnExport) btnExport.disabled=running;
        if(btnCancel) btnCancel.style.display=running?'':'none';
        if(!running){
            const pw=document.getElementById('progWrap');
            if(pw) pw.style.display='none';
        }
    }

    function isRunning(){ return exportRunning; }
    function getActiveEngine(){ return activeEngine; }

    async function runExport({ selected, format, skip, includeIndex, includeAssets, useZip, dirHandle, currentSlot, conversations, exportedIds, takeoutEngine }, callbacks){
        setRunning(true);
        activeEngine = new ( (typeof ExportEngine!=='undefined' ? ExportEngine.ExportEngine : null) || ExportEngine)();
        try{
            const result = await activeEngine.run({ selected, format, skip, includeIndex, includeAssets, useZip, dirHandle, currentSlot, conversations, exportedIds, takeoutEngine }, callbacks);
            return result;
        } finally {
            setRunning(false);
            activeEngine=null;
        }
    }

    function abort(){
        if(activeEngine) activeEngine.abort();
    }

    return { setRunning, isRunning, getActiveEngine, runExport, abort };
}));
