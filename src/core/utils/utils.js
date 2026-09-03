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

    const TITLE_SOURCE_PRIORITY = ['rpc', 'dom', 'takeout', 'sniff', 'legacy', 'default'];

    /**
     * Resolve the most authoritative valid title from a chat object with multi-tier source slots.
     * @param {Object} chat - Conversation object
     * @returns {{ title: string, source: string }}
     */
    function resolveTitle(chat) {
        if (!chat) return { title: '未命名对话', source: 'default' };
        const id = chat.id || '';

        // 1. Traverse tiered title slots in priority order
        if (chat.titles && typeof chat.titles === 'object') {
            for (const source of TITLE_SOURCE_PRIORITY) {
                if (source === 'legacy' || source === 'default') continue;
                const raw = chat.titles[source];
                if (!raw) continue;
                const clean = cleanTitle(raw);
                if (clean && isRealTitle(clean, id)) {
                    return { title: clean, source: source };
                }
            }
        }

        // 2. Legacy fallback to chat.title
        const legacyClean = cleanTitle(chat.title);
        if (legacyClean && isRealTitle(legacyClean, id)) {
            return { title: legacyClean, source: chat.titleSource || 'legacy' };
        }

        // 3. Fallback to Takeout Prompt if present in chat.titles
        if (chat.titles && chat.titles.takeout) {
            const rawTakeout = cleanTitle(chat.titles.takeout);
            if (rawTakeout) return { title: rawTakeout, source: 'takeout' };
        }

        return { title: '未命名对话', source: 'default' };
    }

    /**
     * Set a title into a specific source tier slot without destroying other tiers,
     * and automatically re-calculate the chat.title and chat.titleSource.
     * @param {Object} chat - Conversation object to update
     * @param {string} source - Tier name ('rpc' | 'dom' | 'takeout' | 'sniff')
     * @param {string} rawTitle - Raw title string
     * @returns {{ title: string, source: string }} The resolved title and source
     */
    function setTitleBySource(chat, source, rawTitle) {
        if (!chat) return { title: '未命名对话', source: 'default' };
        chat.titles = (chat.titles && typeof chat.titles === 'object') ? chat.titles : {};
        const cleaned = cleanTitle(rawTitle);
        if (cleaned && isRealTitle(cleaned, chat.id)) {
            chat.titles[source] = cleaned;
        } else if (source === 'takeout' && cleaned) {
            chat.titles[source] = cleaned;
        }
        const resolved = resolveTitle(chat);
        chat.title = resolved.title;
        chat.titleSource = resolved.source;
        return resolved;
    }

    /**
     * Get the authoritative effective timestamp (milliseconds) of a conversation.
     * Prioritizes the latest activity time (updatedAt), then main timestamp,
     * chatTime, createdAt, and finally lastSeen.
     * @param {Object} chat - The conversation object
     * @returns {number} Effective timestamp in milliseconds, or 0 if unknown
     */
    function getEffectiveTimestamp(chat) {
        if (!chat || typeof chat !== 'object') return 0;
        const candidates = [chat.updatedAt, chat.timestamp, chat.chatTime, chat.createdAt, chat.lastSeen];
        for (const raw of candidates) {
            if (raw === null || raw === undefined) continue;
            let ms = (typeof raw === 'string') ? new Date(raw).getTime() : Number(raw);
            if (Number.isFinite(ms) && ms > 0) {
                return ms;
            }
        }
        return 0;
    }

    // Export for different module systems
    if (typeof module === 'object' && module.exports) {
        module.exports = {
            isRealTitle,
            cleanTitle,
            sanitizeFileName,
            normId,
            resolveTitle,
            setTitleBySource,
            getEffectiveTimestamp,
            TITLE_SOURCE_PRIORITY
        };
    } else {
        global.GeminiUtils = global.GeminiUtils || {};
        global.GeminiUtils.isRealTitle = isRealTitle;
        global.GeminiUtils.cleanTitle = cleanTitle;
        global.GeminiUtils.sanitizeFileName = sanitizeFileName;
        global.GeminiUtils.normId = normId;
        global.GeminiUtils.resolveTitle = resolveTitle;
        global.GeminiUtils.setTitleBySource = setTitleBySource;
        global.GeminiUtils.getEffectiveTimestamp = getEffectiveTimestamp;
        global.GeminiUtils.TITLE_SOURCE_PRIORITY = TITLE_SOURCE_PRIORITY;
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
