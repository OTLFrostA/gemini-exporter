// utils.js - Shared utilities for Gemini Exporter
(function(global) {
    'use strict';

    const RESEARCH_PROMPT_PREFIX_RE = /^(?:我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i;

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
        if (!t || t.length < 2) return false;
        if (t === 'Untitled' || t === '未命名' || t === 'New chat' || t === '新对话') return false;
        if (id) {
            let cleanId = String(id).replace(/^c_/, '').trim();
            let cleanT = t.replace(/^c_/, '').trim();
            if (cleanT === cleanId) return false;
            if (cleanT.startsWith('未命名对话(') || cleanT.startsWith('Untitled(')) return false;
            if (cleanT === 'c_' + cleanId || cleanId === 'c_' + cleanT) return false;
        }
        if (/^(未命名对话|Untitled conversation|Untitled|Document|Gemini|Google Gemini|Bard|Google Bard|Google AI|New chat|新对话|Search|搜索)$/i.test(t)) return false;
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return false;
        if (/^(Google Account|Sign in|Sign-in|Sign in with Google|登录|重新登录)/i.test(t)) return false;
        if (/^[a-f0-9_-]{8,64}$/i.test(t)) return false;
        if (/^[0-9a-f]{16}$/i.test(t) || /^c_[0-9a-f]{16}$/i.test(t)) return false;
        if (RESEARCH_PROMPT_PREFIX_RE.test(t)) return false;
        return true;
    }

    /**
     * Unified sanitizeFileName - 单一源，70字符上限，防路径穿越与 Windows 保留名
     */
    function sanitizeFileName(name, fallback = 'untitled') {
        if (!name) return fallback;
        let s = String(name).replace(/[\r\n\t\f\v]+/g, ' ').replace(/[\u0000-\u001F\u007F-\u009F]/g, '_');
        // 防路径穿越 ../  ..\  ...
        s = s.replace(/\.\.\//g, '_').replace(/\.\.\\/g, '_');
        s = s.replace(/[<>:"/\\|?*]+/g, '_');
        s = s.replace(/\.{2,}/g, '_');
        s = s.replace(/^\.+|\.+$/g, '');
        s = s.trim();
        if (!s) return fallback;
        if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = s + '_chat';
        let ext = '';
        const lastDot = s.lastIndexOf('.');
        if (lastDot > 0 && s.length - lastDot <= 6) {
            ext = s.slice(lastDot);
            s = s.slice(0, lastDot);
        }
        if (s.length > 70) s = s.slice(0, 70).trim();
        s = s.replace(/[\.\s_]+$/g, '').trim();
        if (!s) s = fallback;
        return s + ext;
    }

    function normId(id) {
        if (!id) return '';
        return String(id).replace(/^c_/, '').trim();
    }

    /**
     * Clean conversation title by removing brand suffixes and prefixes
     * (e.g., " - Google Gemini", " - Gemini", " | Google Gemini", "Gemini - ").
     * If the title is simply the brand name alone (e.g., "Google Gemini"), returns empty string.
     * @param {string} rawTitle - The raw title string
     * @returns {string} The cleaned title string
     */
    function cleanTitle(rawTitle) {
        if (!rawTitle || typeof rawTitle !== 'string') return '';
        let t = rawTitle.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return '';
        // Remove trailing branding suffixes like " - Google Gemini", " - Gemini", " | Google AI", " · Gemini"
        t = t.replace(/\s*[-–—|·•]\s*(Google\s+)?(Gemini|Bard|Google\s+AI).*$/i, '');
        // Remove leading branding prefixes like "Google Gemini - ", "Gemini - "
        t = t.replace(/^(Google\s+)?(Gemini|Bard|Google\s+AI)\s*[-–—|·•]\s*/i, '');
        t = t.trim();
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return '';
        return t;
    }

    // Export for different module systems
    if (typeof module === 'object' && module.exports) {
        module.exports = { isRealTitle, cleanTitle, sanitizeFileName, normId };
    } else {
        global.GeminiUtils = global.GeminiUtils || {};
        global.GeminiUtils.isRealTitle = isRealTitle;
        global.GeminiUtils.cleanTitle = cleanTitle;
        global.GeminiUtils.sanitizeFileName = sanitizeFileName;
        global.GeminiUtils.normId = normId;
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
