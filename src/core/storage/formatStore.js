// src/core/formatStore.js - Pure format validation + storage sync, no DOM
// Depends on GeminiConstants (ALLOWED_FORMATS) if available, otherwise fallback
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../utils/constants.js'));
    else root.FormatStore = factory(root.GeminiConstants);
}(typeof self !== 'undefined' ? self : this, function(Constants) {
    'use strict';
    const ALLOWED = (Constants && Constants.ALLOWED_FORMATS) || ['markdown','json_openai','json','json_raw'];
    const DEFAULT = (Constants && Constants.DEFAULT_FORMAT) || 'markdown';

    function isAllowed(val) {
        return ALLOWED.includes(val);
    }

    function normalizeFormat(val, isDev) {
        if (!isAllowed(val)) return DEFAULT;
        if (val === 'json_raw' && !isDev) return DEFAULT;
        return val;
    }

    // Validate against actual <select> options if DOM element provided (handles future option drift)
    function validateAgainstSelect(val, selectEl) {
        if (!selectEl || !selectEl.options) return isAllowed(val);
        return Array.from(selectEl.options).some(o => o.value === val);
    }

    async function loadFormat(selectEl) {
        try {
            const data = await chrome.storage.local.get(['gemini_export_format', 'gemini_dev_mode']);
            const isDev = !!data.gemini_dev_mode;
            const stored = data.gemini_export_format;
            if (!stored) return { format: DEFAULT, isDev, stored: null };
            const normalized = normalizeFormat(stored, isDev);
            // If select exists, ensure option exists; otherwise fallback
            const finalVal = (selectEl && !validateAgainstSelect(normalized, selectEl)) ? DEFAULT : normalized;
            if (finalVal !== stored) {
                await chrome.storage.local.set({ gemini_export_format: finalVal });
            }
            if (selectEl) selectEl.value = finalVal;
            return { format: finalVal, isDev, stored };
        } catch (e) {
            if (selectEl) selectEl.value = DEFAULT;
            return { format: DEFAULT, isDev: false, stored: null };
        }
    }

    async function saveFormat(val) {
        const toSave = isAllowed(val) ? val : DEFAULT;
        await chrome.storage.local.set({ gemini_export_format: toSave });
        return toSave;
    }

    function getFormatFromSelect(selectEl) {
        let v = selectEl ? selectEl.value : DEFAULT;
        if (!isAllowed(v)) v = DEFAULT;
        try {
            const isDev = document.body && document.body.classList.contains('dev-mode');
            if (v === 'json_raw' && !isDev) v = DEFAULT;
        } catch {}
        return v;
    }

    function bindFormatSelect(selectEl) {
        if (!selectEl) return;
        selectEl.addEventListener('change', e => saveFormat(e.target.value));
    }

    // Called when dev mode toggles: auto fallback json_raw -> markdown
    async function handleDevToggle(devOn, selectEl) {
        if (!devOn && selectEl && selectEl.value === 'json_raw') {
            selectEl.value = DEFAULT;
            await saveFormat(DEFAULT);
        }
    }

    return { ALLOWED_FORMATS: ALLOWED, DEFAULT_FORMAT: DEFAULT, isAllowed, normalizeFormat, validateAgainstSelect, loadFormat, saveFormat, getFormatFromSelect, bindFormatSelect, handleDevToggle };
}));
