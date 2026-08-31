// utils.js - Shared utilities for Gemini Exporter
(function(global) {
    'use strict';

    /**
     * Determine if a title is a real, meaningful conversation title
     * (not a placeholder, ID, or auto-generated default).
     * @param {string} title - The conversation title to check
     * @param {string} [id] - The conversation ID for comparison
     * @returns {boolean} true if the title is a real, user-facing title
     */
    function isRealTitle(title, id) {
        if (!title || typeof title !== 'string') return false;
        let t = title.trim();
        if (t.length < 2) return false;
        if (id) {
            let cleanId = String(id).replace(/^c_/, '').trim();
            let cleanT = t.replace(/^c_/, '').trim();
            if (cleanT === cleanId) return false;
            if (cleanT.startsWith('未命名对话(') || cleanT.startsWith('Untitled(')) return false;
        }
        if (/^(未命名对话|Untitled conversation|Untitled|Document|Gemini|New chat|新对话|Search|搜索)$/i.test(t)) return false;
        if (/^Google Account/i.test(t)) return false;
        if (/^[a-f0-9_-]{8,64}$/i.test(t)) return false;
        return true;
    }

    // Export for different module systems
    if (typeof module === 'object' && module.exports) {
        module.exports = { isRealTitle };
    } else {
        global.GeminiUtils = global.GeminiUtils || {};
        global.GeminiUtils.isRealTitle = isRealTitle;
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
