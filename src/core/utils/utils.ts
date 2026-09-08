// utils.ts - Shared utilities for Gemini Exporter

import type { Conversation } from '../../types/index.js';

export interface TitleResolution {
    title: string;
    source: string;
}

export interface ExportProgressFormatted {
    text: string;
    pct: number;
}

export interface ExportProgressInput {
    pct?: number;
    current?: number;
    total?: number;
    title?: string;
    assetsDownloaded?: number;
    assetsTotal?: number;
    [key: string]: any;
}

export interface GeminiUtilsModule {
    isDevMode: () => boolean;
    isRealTitle: (title?: string | null, id?: string | number) => boolean;
    cleanTitle: (rawTitle?: string | null) => string;
    sanitizeFileName: (name?: string | null, fallback?: string) => string;
    sanitizeRelativePath: (p?: string | null, defaultName?: string) => string;
    normId: (id?: string | number | null) => string;
    resolveTitle: (chat?: Partial<Conversation> | null) => TitleResolution;
    setTitleBySource: (chat?: any, source?: string, rawTitle?: string) => TitleResolution;
    getEffectiveTimestamp: (chat?: Partial<Conversation> | null) => number;
    compareConversations: (a?: Partial<Conversation> | null, b?: Partial<Conversation> | null) => number;
    formatExportProgress: (progress?: ExportProgressInput | number | null, txt?: string, isEn?: boolean) => ExportProgressFormatted;
    TITLE_SOURCE_PRIORITY: string[];
}

declare global {
    var GeminiUtils: GeminiUtilsModule;
    var __gemExporterDevMode: boolean | undefined;
    var __gemExporterVerboseLog: boolean | undefined;
    var __gemExporterLogAll: boolean | undefined;
}

(function(global: any) {
    'use strict';

    const RESEARCH_PROMPT_PREFIX_RE = /^(?:我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i;

    /**
     * Determine if a title is a real, meaningful conversation title
     * (not a placeholder, ID, or auto-generated default).
     */
    function isRealTitle(title?: string | null, id?: string | number): boolean {
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
    function sanitizeFileName(name?: string | null, fallback: string = 'untitled'): string {
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

    /**
     * Unified sanitizeRelativePath - 单一源，拆分各级相对路径分段清洗，阻断 .. 路径穿越并统一正斜杠
     */
    function sanitizeRelativePath(p?: string | null, defaultName: string = 'file'): string {
        if (!p || typeof p !== 'string') return '';
        const segments = p.split(/[/\\]/).map(seg => {
            let clean = seg.trim();
            if (!clean || clean === '.' || clean === '..') return '_';
            clean = clean.replace(/\.\./g, '_');
            return sanitizeFileName(clean, defaultName);
        }).filter(Boolean);
        return segments.join('/');
    }

    function normId(id?: string | number | null): string {
        if (!id) return '';
        return String(id).replace(/^c_/, '').trim();
    }

    /**
     * Single source for the synchronous dev/verbose flags
     */
    function isDevMode(): boolean {
        if (typeof globalThis !== 'undefined' && (globalThis.__gemExporterDevMode || globalThis.__gemExporterVerboseLog || globalThis.__gemExporterLogAll)) return true;
        if (typeof window !== 'undefined' && ((window as any).__gemExporterDevMode || (window as any).__gemExporterVerboseLog || (window as any).__gemExporterLogAll)) return true;
        return false;
    }

    /**
     * Clean conversation title by removing brand suffixes and prefixes
     */
    function cleanTitle(rawTitle?: string | null): string {
        if (!rawTitle || typeof rawTitle !== 'string') return '';
        let t = rawTitle.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return '';
        t = t.replace(/\s*[-–—|·•]\s*(Google\s+)?(Gemini|Bard|Google\s+AI).*$/i, '');
        t = t.replace(/^(Google\s+)?(Gemini|Bard|Google\s+AI)\s*[-–—|·•]\s*/i, '');
        t = t.trim();
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(t)) return '';
        return t;
    }

    const TITLE_SOURCE_PRIORITY: string[] = ['rpc', 'dom', 'takeout', 'sniff', 'legacy', 'default'];

    /**
     * Resolve the most authoritative valid title from a chat object with multi-tier source slots.
     */
    function resolveTitle(chat?: Partial<Conversation> | null): TitleResolution {
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
     * Set a title into a specific source tier slot without destroying other tiers.
     */
    function setTitleBySource(chat: any, source?: string, rawTitle?: string): TitleResolution {
        if (!chat) return { title: '未命名对话', source: 'default' };
        chat.titles = (chat.titles && typeof chat.titles === 'object') ? chat.titles : {};
        const cleaned = cleanTitle(rawTitle);
        if (cleaned && isRealTitle(cleaned, chat.id)) {
            if (source) chat.titles[source as string] = cleaned;
        } else if (source === 'takeout' && cleaned) {
            if (source) chat.titles[source as string] = cleaned;
        }
        const resolved = resolveTitle(chat);
        chat.title = resolved.title;
        chat.titleSource = resolved.source;
        return resolved;
    }

    /**
     * Get the authoritative effective timestamp (milliseconds) of a conversation.
     */
    function getEffectiveTimestamp(chat?: Partial<Conversation> | null): number {
        if (!chat || typeof chat !== 'object') return 0;
        const candidates = [chat.updatedAt, chat.timestamp, (chat as any).chatTime, chat.createdAt, (chat as any).lastSeen];
        for (const raw of candidates) {
            if (raw === null || raw === undefined) continue;
            let ms = (typeof raw === 'string') ? new Date(raw).getTime() : Number(raw);
            if (Number.isFinite(ms) && ms > 0) {
                return ms;
            }
        }
        return 0;
    }

    /**
     * Formats export progress details into human-readable text and percentage.
     */
    function formatExportProgress(progress?: ExportProgressInput | number | null, txt?: string, isEn: boolean = false): ExportProgressFormatted {
        let pct = 0;
        let text = '';

        if (typeof progress === 'object' && progress !== null) {
            pct = typeof progress.pct === 'number' ? progress.pct : 0;
            const current = progress.current || 0;
            const total = progress.total || 0;
            let title = progress.title || txt || '';
            const assetsDownloaded = progress.assetsDownloaded || 0;
            const assetsTotal = progress.assetsTotal || 0;

            if (title === 'Preparing...') {
                title = isEn ? 'Preparing...' : '准备导出...';
            } else if (title === 'Packaging ZIP file...') {
                title = isEn ? 'Packaging ZIP file...' : '正在打包 ZIP 文件...';
            } else if (title === 'Export complete!') {
                title = isEn ? 'Export complete!' : '导出完成！';
            }

            const parts: string[] = [];
            if (total > 0) {
                const chatLabel = isEn ? 'Exporting' : '导出中';
                parts.push(`${chatLabel} (${current}/${total})`);
            }
            if (title) {
                parts.push(title);
            }
            if (assetsTotal > 0 || assetsDownloaded > 0) {
                const assetLabel = isEn ? 'Assets' : '附件';
                parts.push(`📎 ${assetLabel} ${assetsDownloaded}/${assetsTotal}`);
            }

            text = parts.join(' · ');
        } else {
            pct = typeof progress === 'number' ? progress : 0;
            text = txt || '';
        }

        return { text, pct: Math.min(Math.max(pct, 0), 100) };
    }

    /**
     * Authoritative conversation comparator for consistent ordering across UI and background sync.
     */
    function compareConversations(a?: any, b?: any): number {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;

        const tsA = getEffectiveTimestamp(a);
        const tsB = getEffectiveTimestamp(b);
        if (tsA !== tsB) return tsB - tsA;

        const idxA = typeof a.sidebarIndex === 'number' ? a.sidebarIndex : 999999;
        const idxB = typeof b.sidebarIndex === 'number' ? b.sidebarIndex : 999999;
        if (idxA !== idxB) return idxA - idxB;

        let lsA = 0;
        if (a.lastSeen) {
            lsA = (typeof a.lastSeen === 'string') ? new Date(a.lastSeen).getTime() : Number(a.lastSeen);
            if (!Number.isFinite(lsA)) lsA = 0;
        }
        let lsB = 0;
        if (b.lastSeen) {
            lsB = (typeof b.lastSeen === 'string') ? new Date(b.lastSeen).getTime() : Number(b.lastSeen);
            if (!Number.isFinite(lsB)) lsB = 0;
        }
        return lsB - lsA;
    }

    const utilsModule: GeminiUtilsModule = {
        isDevMode,
        isRealTitle,
        cleanTitle,
        sanitizeFileName,
        sanitizeRelativePath,
        normId,
        resolveTitle,
        setTitleBySource,
        getEffectiveTimestamp,
        compareConversations,
        formatExportProgress,
        TITLE_SOURCE_PRIORITY
    };

    // Export for different module systems
    if (typeof module === 'object' && module.exports) {
        module.exports = utilsModule;
    } else {
        global.GeminiUtils = global.GeminiUtils || {};
        Object.assign(global.GeminiUtils, utilsModule);
    }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
