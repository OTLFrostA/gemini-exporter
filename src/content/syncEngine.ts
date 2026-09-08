// src/content/syncEngine.ts - In-page active conversation detection & cloud batch sync
import { DomScraper } from './domScraper';
import { BadgeView } from './badgeView';
import { contentContext } from './contentContext';

const getStorage = () => (typeof StorageService !== 'undefined' ? StorageService : null) as any;
const getScraper = () => DomScraper;
const getBadge = () => BadgeView;
const getUtils = () => (typeof GeminiUtils !== 'undefined' ? GeminiUtils : null) as any;
const getProtocol = () => (typeof GeminiProtocol !== 'undefined' ? GeminiProtocol : null) as any;
const getApiClientClass = () => (typeof GeminiAPIClient !== 'undefined' ? GeminiAPIClient : null) as any;

export const cleanTitle = (t?: string | null) => (getUtils()?.cleanTitle ? getUtils().cleanTitle(t || '') : (t || '').trim());
export const isRealTitle = (t?: string | null, id?: string) => (getUtils()?.isRealTitle ? getUtils().isRealTitle(t || '', id) : !!(t && String(t).trim().length > 1));
export const resolveTitle = (chat: any) => (getUtils()?.resolveTitle ? getUtils().resolveTitle(chat) : { title: chat?.title || '未命名对话', source: 'default' });
export const compareConversations = (a: any, b: any) => (getUtils()?.compareConversations ? getUtils().compareConversations(a, b) : 0);

export function isZh(): boolean {
    return contentContext.isZh();
}

export function setLanguage(lang: string): void {
    contentContext.setLanguage(lang);
}

export function getAccountSlot(): string {
    if (typeof location === 'undefined') return 'u0';
    const m = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
    return m ? ('u' + m[1]) : 'u0';
}

export function updateBadge(mergedLen?: number, visible?: number, overrideText?: string, isSyncing = false): void {
    const Badge = getBadge();
    if (Badge && Badge.updateBadge) {
        Badge.updateBadge(mergedLen, visible, overrideText, isSyncing, { isZh, getAccountSlot });
    }
}

export async function refreshInitialBadge(): Promise<void> {
    try {
        const slot = getAccountSlot();
        const Storage = getStorage();
        const convs = Storage ? await Storage.getConversations(slot) : [];
        if (convs && convs.length > 0) {
            updateBadge(convs.length, 0);
        } else {
            const zh = isZh();
            updateBadge(0, 0, zh ? '就绪 (0 条)' : 'Ready (0)');
        }
    } catch (e) {
        if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine] refreshInitialBadge error', e);
    }
}

export function extractActiveChatTitle(activeId: string): { title: string; source: string } | null {
    if (!activeId || typeof document === 'undefined') return null;
    // 1. From DOM conversation title / header elements (Tier: 'dom')
    const titleEls = document.querySelectorAll('[data-test-id="conversation-title"], .conversation-title, h1, [class*="conversation-title"]');
    for (const el of Array.from(titleEls)) {
        const t = cleanTitle(el.textContent || '');
        if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
    }
    // 2. From active sidebar element (Tier: 'dom')
    const activeLink = document.querySelector(`a[href*="${activeId}"]`);
    if (activeLink) {
        const t = cleanTitle(activeLink.querySelector('.title, [class*="title"]')?.textContent || activeLink.textContent || '');
        if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
    }
    // 3. From first user query on the page (Tier: 'sniff')
    const firstUserQuery = document.querySelector('user-query .query-text, user-query [data-test-id="query-text"], user-query p, user-query');
    if (firstUserQuery) {
        const t = cleanTitle((firstUserQuery.textContent || '').trim().slice(0, 60).replace(/\n+/g, ' '));
        if (isRealTitle(t, activeId)) return { title: t, source: 'sniff' };
    }
    // 4. From document.title only if it is a real title (Tier: 'sniff')
    if (document.title) {
        const t = cleanTitle(document.title);
        if (isRealTitle(t, activeId)) return { title: t, source: 'sniff' };
    }
    return null;
}

const __fetchingDetailMap = new Map<string, number>();
export function scheduleActiveChatDetailFetch(activeId: string): void {
    if (!activeId || __fetchingDetailMap.has(activeId)) return;
    __fetchingDetailMap.set(activeId, Date.now());
    setTimeout(async () => {
        try {
            const slot = getAccountSlot();
            const Storage = getStorage();
            const existing = Storage ? await Storage.getConversations(slot) : [];
            const found = existing.find((c: any) => String(c.id).replace(/^c_/, '') === activeId);
            if (found && (found.updatedAt || found.timestamp)) {
                return;
            }

            const ClientClass = getApiClientClass();
            if (!ClientClass) return;
            const client = new ClientClass();
            const d = await client.getConversationDetail(activeId);
            if (d && d.id) {
                const nid = String(d.id).replace(/^c_/, '').trim();
                const targetTs = d.updatedAt || d.timestamp || null;
                if (targetTs) {
                    await upsertConversations([{
                        id: nid,
                        title: d.title,
                        titleSource: d.titleSource || 'rpc',
                        titles: d.titles || {},
                        url: d.url || `https://gemini.google.com/app/${nid}`,
                        href: d.url || `https://gemini.google.com/app/${nid}`,
                        timestamp: targetTs,
                        updatedAt: targetTs,
                        createdAt: d.createdAt || null,
                        messageCount: d.messageCount
                    }], 'active-detail-sync');
                }
            }
        } catch (err) {
            if (contentContext.isDevMode()) console.debug('[Gemini Exporter] scheduleActiveChatDetailFetch err', err);
        } finally {
            setTimeout(() => __fetchingDetailMap.delete(activeId), 10000);
        }
    }, 200);
}

let __storageWriteQueue = Promise.resolve<any>(0);
let __lastKnownCount = 0;

export function upsertConversations(incomingItems: any[], source: string, forceWrite = false, targetSlot: string | null = null): Promise<number> {
    if (!incomingItems || !incomingItems.length) return Promise.resolve(0);
    __storageWriteQueue = __storageWriteQueue.then(async () => {
        try {
            const slot = targetSlot || getAccountSlot();
            const Storage = getStorage();
            const existing = Storage ? await Storage.getConversations(slot) : [];
            const map = new Map<string, any>();
            existing.forEach((c: any) => {
                if (!c || !c.id) return;
                const nid = String(c.id).replace(/^c_/, '').trim();
                c.id = nid;
                map.set(nid, c);
            });
            const now = Date.now();
            let changed = 0;

            incomingItems.forEach((c, idx) => {
                if (!c || !c.id) return;
                const nid = String(c.id).replace(/^c_/, '').trim();
                c.id = nid;
                const old = map.get(nid);

                const mergedTitles = { ...(old?.titles || {}) };
                if (c.titles && typeof c.titles === 'object') {
                    Object.assign(mergedTitles, c.titles);
                }
                if (c.titleSource && c.title) {
                    const cleanT = cleanTitle(c.title);
                    if (cleanT && (isRealTitle(cleanT, nid) || c.titleSource === 'takeout')) {
                        mergedTitles[c.titleSource] = cleanT;
                    }
                } else if (c.title && !mergedTitles.legacy && !mergedTitles.rpc && !mergedTitles.dom && !mergedTitles.takeout) {
                    const cleanT = cleanTitle(c.title);
                    if (cleanT && isRealTitle(cleanT, nid)) {
                        mergedTitles.legacy = cleanT;
                    }
                }

                const tempChat = {
                    id: nid,
                    titles: mergedTitles,
                    title: c.title || old?.title,
                    titleSource: c.titleSource || old?.titleSource
                };

                const resolved = resolveTitle(tempChat);
                const resolvedTitle = resolved.title;
                const resolvedSource = resolved.source;

                let cUpdated = c.updatedAt || c.timestamp || null;
                if (typeof cUpdated === 'string') cUpdated = new Date(cUpdated).getTime();
                let oldUpdated = old?.updatedAt || old?.timestamp || null;
                if (typeof oldUpdated === 'string') oldUpdated = new Date(oldUpdated).getTime();

                const isRpcSource = source === 'network-list' || c.titleSource === 'rpc';
                let bestUpdatedAt = oldUpdated;
                if (cUpdated && (isRpcSource || !bestUpdatedAt || cUpdated > bestUpdatedAt)) {
                    bestUpdatedAt = cUpdated;
                }

                let cCreated = c.createdAt || null;
                if (typeof cCreated === 'string') cCreated = new Date(cCreated).getTime();
                let oldCreated = old?.createdAt || null;
                if (typeof oldCreated === 'string') oldCreated = new Date(oldCreated).getTime();
                let bestCreatedAt = oldCreated || cCreated || null;
                if (cCreated && oldCreated && cCreated < oldCreated) {
                    bestCreatedAt = cCreated;
                }

                const bestTimestamp = isRpcSource ? (cUpdated || bestUpdatedAt) : (bestUpdatedAt || old?.timestamp || c.timestamp || null);

                if (!old) {
                    changed++;
                } else if (old.title !== resolvedTitle || (!old.timestamp && bestTimestamp) || (bestUpdatedAt && bestUpdatedAt !== oldUpdated)) {
                    changed++;
                }
                map.set(nid, {
                    ...(old || {}),
                    ...c,
                    id: nid,
                    titles: mergedTitles,
                    title: resolvedTitle,
                    titleSource: resolvedSource,
                    timestamp: bestTimestamp,
                    updatedAt: bestUpdatedAt || bestTimestamp,
                    createdAt: bestCreatedAt,
                    sidebarIndex: typeof c.sidebarIndex === 'number' ? c.sidebarIndex : old?.sidebarIndex,
                    lastSeen: (c.lastSeen || (old && old.lastSeen) || new Date(now - idx).toISOString()),
                    source: source || (old && old.source) || 'unknown',
                    accountSlot: slot
                });
            });

            const merged = Array.from(map.values());
            merged.sort(compareConversations);

            if (!forceWrite && changed === 0) {
                if (__lastKnownCount !== merged.length) {
                    updateBadge(merged.length, incomingItems.length);
                }
                return merged.length;
            }

            if (Storage) {
                await Storage.setConversations(slot, merged);
                await Storage.setLastSync(slot, Date.now(), merged.length);
                await Storage.updateAccountSlot(slot, {
                    slot,
                    name: slot === 'u0' ? 'Default Account (u0)' : `Account ${slot.toUpperCase()}`,
                    count: merged.length,
                    lastSync: new Date().toISOString()
                });
            }

            try {
                const p = chrome.runtime.sendMessage({
                    action: 'syncUpdate',
                    slot,
                    count: merged.length,
                    newCount: incomingItems.length,
                    from: source
                });
                if (p && p.catch) p.catch(() => {});
            } catch (e) {
                if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
            }

            updateBadge(merged.length, incomingItems.length);
            return merged.length;
        } catch (e: any) {
            if (e?.message?.includes('Extension context invalidated')) return 0;
            console.error('[Gemini Exporter] upsertConversations failed', e);
        }
    });
    return __storageWriteQueue;
}

export async function syncOnce(): Promise<number> {
    try {
        const items: any[] = [];
        // 1. Check current active page chat
        const m = typeof location !== 'undefined' ? location.pathname.match(/\/app\/(c_)?([A-Za-z0-9_-]{8,})/) : null;
        let activeId: string | null = null;
        if (m) {
            activeId = m[2].replace(/^c_/, '');
            const activeTitleObj = extractActiveChatTitle(activeId);
            if (activeTitleObj && activeTitleObj.title) {
                const titlesMap: Record<string, string> = {};
                titlesMap[activeTitleObj.source] = activeTitleObj.title;
                items.push({
                    id: activeId,
                    title: activeTitleObj.title,
                    titleSource: activeTitleObj.source,
                    titles: titlesMap,
                    url: `https://gemini.google.com/app/${activeId}`,
                    href: `https://gemini.google.com/app/${activeId}`
                });
            }
        }

        // 2. Collect from sidebar links
        const Scraper = getScraper();
        if (Scraper && typeof Scraper.getConversationLinks === 'function') {
            const links = Scraper.getConversationLinks() || [];
            items.push(...links);
        }

        if (!items.length) return 0;
        const resLen = await upsertConversations(items, 'page-sync');

        // 3. Asynchronously fetch full details/timestamps for newly discovered active chat
        if (activeId) {
            scheduleActiveChatDetailFetch(activeId);
        }

        return resLen;
    } catch (e) {
        if (contentContext.isDevMode()) console.debug('[Gemini Exporter] syncOnce err', e);
        return 0;
    }
}

export async function tryBatchExecuteFull(forceOpts?: { forceFull?: boolean; forceIncremental?: boolean; maxPages?: number }): Promise<any> {
    if (contentContext.getDeepScanPromise()) return null;

    let _resolve: (() => void) | undefined;
    const scanPromise = new Promise<void>(r => { _resolve = r; });
    contentContext.setDeepScanPromise(scanPromise);

    try {
        document.getElementById('geminiExportBadge')?.classList.add('syncing');
        const ClientClass = getApiClientClass();
        if (!ClientClass) return null;
        const client = new ClientClass();
        contentContext.setActiveClient(client);
        contentContext.setAborted(false);

        const slot = getAccountSlot();
        const Storage = getStorage();
        const beforeList = Storage ? await Storage.getConversations(slot) : [];
        const beforeMap = new Map(beforeList.map((c: any) => [c.id, c]));
        let useIncremental = beforeList.length > 30;
        if (forceOpts?.forceFull) useIncremental = false;
        if (forceOpts?.forceIncremental) useIncremental = true;

        const effectiveMaxPages = forceOpts?.maxPages || (useIncremental ? 2 : 2000);

        let saveQueue = Promise.resolve<any>(0);
        const all = await client.getAllConversations(effectiveMaxPages, (prog: any) => {
            const badge = document.getElementById('geminiExportBadgeText');
            if (badge) {
                if (prog.stoppedEarly) badge.textContent = `已同步 ${prog.total} 条 ✓`;
                else badge.textContent = `正在同步: 已获取 ${prog.total} 条${prog.hasMore ? '…' : ''}`;
            }
            try {
                const page = prog.page || 1;
                const estPercent = prog.hasMore ? Math.min(5 + page * 2, 95) : 98;
                const _p = chrome.runtime.sendMessage({
                    action: 'scanProgress',
                    done: page,
                    count: prog.total,
                    percent: estPercent,
                    title: `正在同步第 ${page} 页 (已获取 ${prog.total} 条)${prog.hasMore ? '…' : ''}`
                });
                if (_p && _p.catch) _p.catch(() => {});
            } catch (e) {
                if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
            }

            if (prog.batch && prog.batch.length) {
                saveQueue = saveQueue.then(() => upsertConversations(prog.batch, 'batchexecute', true));
            }
        }, null, {
            existingMap: beforeMap,
            incremental: useIncremental,
            unchangedThreshold: 5
        });
        await saveQueue;

        if (all && all.diagnostics) {
            try {
                await chrome.storage.local.set({ gemini_last_sync_diagnostics: all.diagnostics });
            } catch (e) { console.warn('[GemExporter:storage] Storage operation failed:', e); }
        }

        if (all && all.conversations && all.conversations.length) {
            let mergedLen = await upsertConversations(all.conversations, 'batchexecute', true);
            const isFullExhaustive = !useIncremental && !all.stoppedEarly && !contentContext.isAborted();
            if (isFullExhaustive && Storage && typeof Storage.reconcileConversations === 'function') {
                const recRes = await Storage.reconcileConversations(slot, all.conversations, { keepTakeout: true });
                if (recRes && recRes.removed > 0) {
                    console.log(`[Gemini Exporter] Reconciled with cloud: pruned ${recRes.removed} deleted conversations`, recRes.removedIds);
                    mergedLen = recRes.kept;
                }
            }
            const Proto = getProtocol();
            const slidingLimit = Proto?.LIMITS?.SLIDING_WINDOW || 600;
            const isLimit = !!(all?.hitGoogleLimit || all?.diagnostics?.hitGoogleLimit || (!useIncremental && mergedLen >= slidingLimit));
            const badge = document.getElementById('geminiExportBadgeText');
            if (badge) badge.textContent = `已同步 ${mergedLen} 条 ✓`;
            if (isLimit && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                try {
                    const existing = await chrome.storage.local.get(['has_completed_takeout_prompt']);
                    if (!existing?.has_completed_takeout_prompt) {
                        chrome.storage.local.set({
                            gemini_pending_takeout_prompt: {
                                slot,
                                count: mergedLen,
                                hitGoogleLimit: !!(all?.hitGoogleLimit || all?.diagnostics?.hitGoogleLimit),
                                timestamp: Date.now()
                            }
                        }).catch(() => {});
                    }
                } catch (e) {
                    if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
                }
            }
            try {
                const _p = chrome.runtime.sendMessage({
                    action: 'scanProgress',
                    done: 1,
                    total: 1,
                    percent: 100,
                    count: mergedLen,
                    hitGoogleLimit: isLimit,
                    title: `同步完成，共 ${mergedLen} 条`
                });
                if (_p && _p.catch) _p.catch(() => {});
            } catch (e) {
                if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
            }
            return { count: mergedLen, diagnostics: all.diagnostics, hitGoogleLimit: isLimit };
        }
        if (all && all.diagnostics) {
            return { count: 0, diagnostics: all.diagnostics, hitGoogleLimit: !!(all?.hitGoogleLimit || all?.diagnostics?.hitGoogleLimit) };
        }
    } catch (e: any) {
        if (contentContext.isDevMode()) console.debug('[Gemini Exporter] batch exec fail', e.message || e);
    } finally {
        document.getElementById('geminiExportBadge')?.classList.remove('syncing');
        contentContext.setActiveClient(null);
        contentContext.setDeepScanPromise(null);
        if (_resolve) _resolve();
    }
    return null;
}

export const SyncEngine = {
    getAccountSlot,
    isZh,
    setLanguage,
    updateBadge,
    refreshInitialBadge,
    extractActiveChatTitle,
    scheduleActiveChatDetailFetch,
    upsertConversations,
    syncOnce,
    tryBatchExecuteFull,
    compareConversations
};

if (typeof globalThis !== 'undefined') {
    (globalThis as any).SyncEngine = SyncEngine;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SyncEngine;
}
