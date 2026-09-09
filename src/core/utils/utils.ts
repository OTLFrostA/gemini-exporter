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

export interface MergeConversationOptions {
    isRpcSource?: boolean;
    now?: number | string;
    source?: string;
    targetSlot?: string;
}

export interface MergeConversationResult {
    merged: any;
    isChanged: boolean;
    hasDirtyTitles: boolean;
}

export interface DeduplicateResult {
    processed: any[];
    changedCount: number;
    hasDirtyTitles: boolean;
}

export interface GeminiUtilsModule {
    isDevMode: () => boolean;
    isRealTitle: (title?: string | null, id?: string | number) => boolean;
    cleanTitle: (rawTitle?: string | null) => string;
    sanitizeFileName: (name?: string | null, fallback?: string) => string;
    sanitizeRelativePath: (p?: string | null, defaultName?: string) => string;
    normId: (id?: string | number | null) => string;
    isReservedRoute: (id?: string | number | null) => boolean;
    RESERVED_ROUTES: Set<string>;
    resolveTitle: (chat?: Partial<Conversation> | null) => TitleResolution;
    setTitleBySource: (chat?: any, source?: string, rawTitle?: string) => TitleResolution;
    getEffectiveTimestamp: (chat?: Partial<Conversation> | null) => number;
    compareConversations: (a?: Partial<Conversation> | null, b?: Partial<Conversation> | null) => number;
    formatExportProgress: (progress?: ExportProgressInput | number | null, txt?: string, isEn?: boolean) => ExportProgressFormatted;
    mergeConversation: (existing: any, incoming: any, options?: MergeConversationOptions) => MergeConversationResult;
    deduplicateConversations: (list: any[], options?: MergeConversationOptions) => DeduplicateResult;
    TITLE_SOURCE_PRIORITY: string[];
}

declare global {
    var GeminiUtils: GeminiUtilsModule;
    var __gemExporterDevMode: boolean | undefined;
    var __gemExporterVerboseLog: boolean | undefined;
    var __gemExporterLogAll: boolean | undefined;
}

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

    const RESERVED_ROUTES = new Set([
        'download', 'settings', 'prompts', 'archive', 'trash', 'share',
        'activity', 'help', 'feedback', 'gems', 'explore', 'privacy', 'terms', 'updates', 'faq'
    ]);

    function isReservedRoute(id?: string | number | null): boolean {
        if (!id) return false;
        const clean = normId(id).toLowerCase();
        return RESERVED_ROUTES.has(clean);
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

    const cleanForBad = (t: any) => String(t || '').replace(/[\u200E\u200B\uFEFF\u00A0]/g, '').trim();
    const isBadTitle = (t: any) => !t || /^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(cleanForBad(t));

    /**
     * SSoT: Merge an incoming conversation into an existing conversation.
     * Accurately arbitrates multi-tier titles, dates/timestamps, message counts, and dirty title status.
     */
    function mergeConversation(
        old: any,
        incoming: any,
        options?: MergeConversationOptions
    ): MergeConversationResult {
        const id = normId(incoming?.id || old?.id || '');
        const mergedTitles: Record<string, string> = { ...(old?.titles || {}) };

        // 1. Merge incoming.titles if provided
        if (incoming?.titles && typeof incoming.titles === 'object') {
            for (const [k, v] of Object.entries(incoming.titles)) {
                if (typeof v === 'string') {
                    const cleanV = cleanTitle(v);
                    if (cleanV && (isRealTitle(cleanV, id) || k === 'takeout')) {
                        mergedTitles[k] = cleanV;
                    }
                }
            }
        }

        // 2. Merge incoming title + titleSource
        if (incoming?.titleSource && incoming?.title) {
            const cleanT = cleanTitle(incoming.title);
            if (cleanT && (isRealTitle(cleanT, id) || incoming.titleSource === 'takeout')) {
                mergedTitles[incoming.titleSource] = cleanT;
            }
        } else if (incoming?.title && !mergedTitles.legacy && !mergedTitles.rpc && !mergedTitles.dom && !mergedTitles.takeout) {
            const cleanT = cleanTitle(incoming.title);
            if (cleanT && isRealTitle(cleanT, id)) {
                mergedTitles.legacy = cleanT;
            }
        }

        // 3. Preserve old title if real and not yet in titles
        if (old && old.titleSource && old.title && !mergedTitles[old.titleSource]) {
            const cleanOldT = cleanTitle(old.title);
            if (cleanOldT && (isRealTitle(cleanOldT, id) || old.titleSource === 'takeout')) {
                mergedTitles[old.titleSource] = cleanOldT;
            }
        } else if (old && old.title && !mergedTitles.legacy && !mergedTitles.rpc && !mergedTitles.dom && !mergedTitles.takeout) {
            const cleanOldT = cleanTitle(old.title);
            if (cleanOldT && isRealTitle(cleanOldT, id)) {
                mergedTitles.legacy = cleanOldT;
            }
        }

        // 4. Resolve authoritative title
        const tempChat = {
            id,
            titles: mergedTitles,
            title: incoming?.title || old?.title,
            titleSource: incoming?.titleSource || old?.titleSource
        };
        const resolved = resolveTitle(tempChat);
        const resolvedTitle = resolved.title;
        const resolvedSource = resolved.source;

        // 5. Detect dirty title
        let hasDirtyTitles = false;
        if (!old) {
            if (isBadTitle(incoming?.title) || incoming?.title !== resolvedTitle) {
                hasDirtyTitles = true;
            }
        } else {
            if (isBadTitle(old.title) || old.title !== resolvedTitle) {
                hasDirtyTitles = true;
            }
        }

        // 6. Timestamps arbitration
        let cUpdated: any = incoming?.updatedAt || incoming?.timestamp || null;
        if (typeof cUpdated === 'string') cUpdated = new Date(cUpdated).getTime();
        if (!Number.isFinite(cUpdated) || cUpdated <= 0) cUpdated = null;

        let oldUpdated: any = old?.updatedAt || old?.timestamp || null;
        if (typeof oldUpdated === 'string') oldUpdated = new Date(oldUpdated).getTime();
        if (!Number.isFinite(oldUpdated) || oldUpdated <= 0) oldUpdated = null;

        const isRpcSource = options?.isRpcSource ?? (
            options?.source === 'network-list' ||
            incoming?.titleSource === 'rpc' ||
            incoming?.source === 'network-list'
        );

        let bestUpdatedAt = oldUpdated;
        if (cUpdated && (isRpcSource || !bestUpdatedAt || cUpdated > bestUpdatedAt)) {
            bestUpdatedAt = cUpdated;
        }

        let cCreated: any = incoming?.createdAt || null;
        if (typeof cCreated === 'string') cCreated = new Date(cCreated).getTime();
        if (!Number.isFinite(cCreated) || cCreated <= 0) cCreated = null;

        let oldCreated: any = old?.createdAt || null;
        if (typeof oldCreated === 'string') oldCreated = new Date(oldCreated).getTime();
        if (!Number.isFinite(oldCreated) || oldCreated <= 0) oldCreated = null;

        let bestCreatedAt = oldCreated || cCreated || null;
        if (cCreated && oldCreated && cCreated < oldCreated) {
            bestCreatedAt = cCreated;
        }

        const bestTimestamp = isRpcSource
            ? (cUpdated || bestUpdatedAt)
            : (bestUpdatedAt || old?.timestamp || incoming?.timestamp || null);

        // 7. Check if meaningful change occurred
        let isChanged = false;
        if (!old) {
            isChanged = true;
        } else if (
            old.title !== resolvedTitle ||
            (!old.timestamp && bestTimestamp) ||
            (bestUpdatedAt && bestUpdatedAt !== oldUpdated)
        ) {
            isChanged = true;
        }

        // 8. Assemble merged conversation
        const merged: any = {
            ...(old || {}),
            ...(incoming || {}),
            id,
            title: resolvedTitle,
            titleSource: resolvedSource,
            titles: mergedTitles,
            timestamp: bestTimestamp,
            updatedAt: bestUpdatedAt || bestTimestamp,
            createdAt: bestCreatedAt,
            sidebarIndex: typeof incoming?.sidebarIndex === 'number'
                ? incoming.sidebarIndex
                : old?.sidebarIndex
        };

        if (options?.now) {
            merged.lastSeen = options.now;
        }
        if (options?.source) {
            merged.source = options.source || old?.source || 'unknown';
        }
        if (options?.targetSlot) {
            merged.accountSlot = options.targetSlot;
        }

        return { merged, isChanged, hasDirtyTitles };
    }

    /**
     * SSoT: Deduplicate an array of conversations, merging items with identical normId
     * and sorting by authoritative compareConversations.
     */
    function deduplicateConversations(
        list: any[],
        options?: MergeConversationOptions
    ): DeduplicateResult {
        if (!Array.isArray(list)) return { processed: [], changedCount: 0, hasDirtyTitles: false };
        const dedupMap = new Map<string, any>();
        let changedCount = 0;
        let hasDirtyTitles = false;

        for (const item of list) {
            if (!item || !item.id) continue;
            const u = ((item as any).url || (item as any).href || '').toString();
            if (/accounts\.google\.com|SignOutOptions/i.test(u)) continue;

            const nid = normId(item.id);
            if (isReservedRoute(nid) || isReservedRoute(item.id) || /\/app\/(download|settings|prompts|archive|trash|share|activity|help|feedback|gems|explore|privacy|terms|updates|faq)($|\/|\?)/i.test(u)) {
                changedCount++;
                hasDirtyTitles = true;
                continue;
            }

            const existing = dedupMap.get(nid);
            const res = mergeConversation(existing, item, options);
            if (res.isChanged) changedCount++;
            if (res.hasDirtyTitles) hasDirtyTitles = true;
            dedupMap.set(nid, res.merged);
        }

        const processed = Array.from(dedupMap.values());
        processed.sort(compareConversations);
        return { processed, changedCount, hasDirtyTitles };
    }

    export {
        isDevMode,
        isRealTitle,
        cleanTitle,
        sanitizeFileName,
        sanitizeRelativePath,
        normId,
        isReservedRoute,
        RESERVED_ROUTES,
        resolveTitle,
        setTitleBySource,
        getEffectiveTimestamp,
        compareConversations,
        formatExportProgress,
        mergeConversation,
        deduplicateConversations,
        TITLE_SOURCE_PRIORITY
    };

    export const GeminiUtils: GeminiUtilsModule = {
        isDevMode,
        isRealTitle,
        cleanTitle,
        sanitizeFileName,
        sanitizeRelativePath,
        normId,
        isReservedRoute,
        RESERVED_ROUTES,
        resolveTitle,
        setTitleBySource,
        getEffectiveTimestamp,
        compareConversations,
        formatExportProgress,
        mergeConversation,
        deduplicateConversations,
        TITLE_SOURCE_PRIORITY
    };

    if (typeof globalThis !== 'undefined') {
        (globalThis as any).GeminiUtils = GeminiUtils;
    }
    if (typeof module === 'object' && module.exports) {
        module.exports = GeminiUtils;
    }

    export default GeminiUtils;

