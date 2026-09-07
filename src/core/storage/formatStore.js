// src/core/storage/formatStore.js - Pure format validation + storage sync, zero DOM requirement
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

    // Validate against option list (duck-typed options array, zero DOM required)
    function validateAgainstSelect(val, selectEl) {
        if (!selectEl || !selectEl.options) return isAllowed(val);
        return Array.from(selectEl.options).some(o => o.value === val);
    }

    async function loadFormat(selectEl) {
        try {
            const data = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
                ? await chrome.storage.local.get(['gemini_export_format', 'gemini_dev_mode'])
                : {};
            const isDev = !!data.gemini_dev_mode;
            const stored = data.gemini_export_format;
            if (!stored) return { format: DEFAULT, isDev, stored: null };
            const normalized = normalizeFormat(stored, isDev);
            const finalVal = (selectEl && !validateAgainstSelect(normalized, selectEl)) ? DEFAULT : normalized;
            if (finalVal !== stored && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
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
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ gemini_export_format: toSave });
        }
        return toSave;
    }

    function getCurrentFormat(isDev, currentVal) {
        let v = currentVal !== undefined ? currentVal : DEFAULT;
        if (!isAllowed(v)) v = DEFAULT;
        if (v === 'json_raw' && !isDev) v = DEFAULT;
        return v;
    }

    function getFormatFromSelect(selectEl, isDev) {
        let v = selectEl ? selectEl.value : DEFAULT;
        if (!isAllowed(v)) v = DEFAULT;
        const devMode = isDev !== undefined ? isDev : (typeof document !== 'undefined' && document.body && document.body.classList.contains('dev-mode'));
        if (v === 'json_raw' && !devMode) v = DEFAULT;
        return v;
    }

    function bindFormatSelect(selectEl) {
        if (!selectEl) return;
        selectEl.addEventListener('change', e => saveFormat(e.target.value));
    }

    function handleDevToggle(devOn, currentFormatOrSelect) {
        if (currentFormatOrSelect && typeof currentFormatOrSelect === 'object' && 'value' in currentFormatOrSelect) {
            if (!devOn && currentFormatOrSelect.value === 'json_raw') {
                currentFormatOrSelect.value = DEFAULT;
                saveFormat(DEFAULT);
                return { format: DEFAULT, changed: true };
            }
            return { format: currentFormatOrSelect.value, changed: false };
        }
        if (!devOn && currentFormatOrSelect === 'json_raw') {
            return { format: DEFAULT, changed: true };
        }
        return { format: currentFormatOrSelect, changed: false };
    }

    return {
        ALLOWED_FORMATS: ALLOWED,
        DEFAULT_FORMAT: DEFAULT,
        isAllowed,
        normalizeFormat,
        validateAgainstSelect,
        loadFormat,
        saveFormat,
        getCurrentFormat,
        getFormatFromSelect,
        bindFormatSelect,
        handleDevToggle
    };
}));
