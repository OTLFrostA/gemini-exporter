// src/content/syncEngine.ts - In-page active conversation detection & cloud batch sync
import { DomScraper } from './domScraper.js';
import { BadgeView } from './badgeView.js';
import { contentContext } from './contentContext.js';
import { StorageService } from '../core/storage/storageService.js';
import { __resolveModule } from '../core/utils/moduleOverrides.js';
import {
    getErrorMessage,
    cleanTitle,
    isRealTitle,
    resolveTitle,
    compareConversations,
    mergeConversation,
    deduplicateConversations
} from '../core/utils/utils.js';
import { STORAGE_KEYS } from '../core/utils/constants.js';
import { GeminiProtocol } from '../core/protocol/protocol.js';
import { ProviderRegistry } from '../core/provider/providerRegistry.js';
// Side-effect imports kept intentionally: geminiProvider/chatgptProvider self-register
// into ProviderRegistry on module evaluation (see the "Auto-register" blocks at the
// bottom of each file), and nothing else in the static import graph pulls them in —
// without these, ProviderRegistry would stay empty at runtime. Importing the two
// provider modules directly (rather than provider/index.js) keeps the intent precise.
import '../core/provider/gemini/geminiProvider.js';
import '../core/provider/chatgpt/chatgptProvider.js';
import { detectSlotFromUrl, extractConversationIdFromUrl, normId, isReservedRoute } from '../core/utils/pathUtils.js';
import { sniffUserProfileFromDom } from './accountSniffer.js';

const getStorage = () => __resolveModule('StorageService', StorageService);
const getScraper = () => DomScraper;
const getBadge = () => BadgeView;
const getProtocol = () => __resolveModule('GeminiProtocol', GeminiProtocol);
const resolveProvider = () => {
    const url = (typeof location !== 'undefined' && location.href) || '';
    return ProviderRegistry.findByUrl(url) || ProviderRegistry.getDefault();
};

export {
    cleanTitle,
    isRealTitle,
    resolveTitle,
    compareConversations,
    mergeConversation,
    deduplicateConversations
};

export function isZh(): boolean {
    return contentContext.isZh();
}

export function setLanguage(lang: string): void {
    contentContext.setLanguage(lang);
}

export function getAccountSlot(): string {
    return detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined);
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
    // 3. From document.title only if it is a real title (Tier: 'dom')
    if (document.title) {
        const t = cleanTitle(document.title);
        if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
    }
    // 4. From first user query on the page (Tier: 'sniff' fallback)
    const firstUserQuery = document.querySelector('user-query .query-text, user-query [data-test-id="query-text"], user-query p, user-query');
    if (firstUserQuery) {
        const t = cleanTitle((firstUserQuery.textContent || '').trim().slice(0, 60).replace(/\n+/g, ' '));
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
            const found = existing.find((c: any) => normId(c.id) === activeId);
            if (found && (found.updatedAt || found.timestamp)) {
                return;
            }

            const provider = resolveProvider();
            if (!provider) return;
            const d = await provider.fetchConversationDetail(activeId);
            if (d && d.id) {
                const nid = normId(d.id);
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

// Bounded debounce map with size cap and TTL eviction
const __lastTouchedMap = new Map<string, number>();
const LAST_TOUCHED_MAX_ENTRIES = 2000;
const LAST_TOUCHED_TTL_MS = 30 * 60 * 1000;

function pruneLastTouchedMap(now: number): void {
    if (__lastTouchedMap.size > LAST_TOUCHED_MAX_ENTRIES) {
        const overflow = __lastTouchedMap.size - LAST_TOUCHED_MAX_ENTRIES;
        const it = __lastTouchedMap.keys();
        for (let i = 0; i < overflow; i++) {
            const k = it.next();
            if (k.done) break;
            __lastTouchedMap.delete(k.value);
        }
    }
    // Opportunistic TTL eviction (amortized: only when over half the cap)
    if (__lastTouchedMap.size > LAST_TOUCHED_MAX_ENTRIES / 2) {
        for (const [k, v] of __lastTouchedMap) {
            if (now - v > LAST_TOUCHED_TTL_MS) __lastTouchedMap.delete(k);
        }
    }
}

export async function touchActiveConversation(
    cid: string,
    slot?: string,
    options?: { forceWrite?: boolean; source?: string }
): Promise<number> {
    if (!cid) return 0;
    const nid = normId(cid);
    if (!nid) return 0;

    const now = Date.now();
    const lastTouched = __lastTouchedMap.get(nid) || 0;
    if (!options?.forceWrite && (now - lastTouched < 800)) {
        return 0;
    }
    __lastTouchedMap.set(nid, now);
    pruneLastTouchedMap(now);

    const targetSlot = slot || getAccountSlot();
    const activeTitleObj = extractActiveChatTitle(nid);

    // SSOT timestamp authority: timestamp/updatedAt are server-authoritative and
    // are only ever written from RPC/list/detail data. A touch must NOT stamp the
    // client clock here: merge is Math.max-monotonic, so a client-ahead clock
    // would permanently poison the record and no later server timestamp could
    // repair it. Touch updates recency signals only (sidebarIndex/lastSeen);
    // the next list sync brings the real server timestamp.
    // Display recency (bump-to-top) is carried separately by lastActiveAt, a
    // client-observed interaction marker consumed ONLY by the list sort
    // (compareConversations). It never feeds getEffectiveTimestamp, so the
    // scan watermark and export-staleness checks keep seeing server time.
    const item: any = {
        id: nid,
        url: `https://gemini.google.com/app/${nid}`,
        href: `https://gemini.google.com/app/${nid}`,
        sidebarIndex: 0,
        lastActiveAt: now
    };

    if (activeTitleObj && activeTitleObj.title && isRealTitle(activeTitleObj.title, nid)) {
        const cleanT = cleanTitle(activeTitleObj.title);
        const sourceTier = activeTitleObj.source || 'dom';
        item.title = cleanT;
        item.titleSource = sourceTier;
        item.titles = { [sourceTier]: cleanT };
    }

    const source = options?.source || 'stream-complete';
    return await upsertConversations([item], source, options?.forceWrite ?? true, targetSlot);
}

let __storageWriteQueue = Promise.resolve<any>(0);
let __lastKnownCount = 0;
let __syncOnceInFlight = false;

export function upsertConversations(incomingItems: any[], source: string, forceWrite = false, targetSlot: string | null = null): Promise<number> {
    if (!incomingItems || !incomingItems.length) return Promise.resolve(0);

    // Fail-Closed Integrity Gate:
    // If incoming items lack valid IDs or are malformed (e.g. schema drift resulting
    // in 'c_unknown' or missing IDs), filter them out. If no valid items remain,
    // abort storage transaction immediately to protect existing data from corruption.
    const validIncoming = incomingItems.filter(c => {
        if (!c || !c.id) return false;
        const rawId = String(c.id).trim();
        if (rawId === 'c_unknown' || rawId === 'c_' || rawId.toLowerCase() === 'unknown') return false;
        const nid = normId(rawId);
        if (!nid || nid === 'unknown' || nid.length < 3 || isReservedRoute(nid)) return false;
        return true;
    });

    if (validIncoming.length === 0) {
        console.warn('[Gemini Exporter] Fail-Closed: incoming batch has no valid conversation IDs, aborting storage write to protect existing data.');
        return Promise.resolve(0);
    }

    __storageWriteQueue = __storageWriteQueue.then(async () => {
        try {
            const slot = targetSlot || getAccountSlot();
            const Storage = getStorage();
            if (!Storage) return 0;
            const now = Date.now();

            // Cross-tab: read + merge + write run atomically inside the storage
            // transaction. The old shape read outside the lock, so two tabs
            // could build on the same stale snapshot and the later write would
            // silently discard the earlier tab's updates (lost update).
            const tx = await Storage.transactConversations(slot, (existing: any[]) => {
                const map = new Map<string, any>();
                existing.forEach((c: any) => {
                    if (!c || !c.id) return;
                    const nid = normId(c.id);
                    c.id = nid;
                    map.set(nid, c);
                });
                let changed = 0;

                validIncoming.forEach((c, idx) => {
                    if (!c || !c.id) return;
                    const nid = normId(c.id);
                    c.id = nid;
                    const old = map.get(nid);

                    const res = mergeConversation(old, c, {
                        source,
                        targetSlot: slot
                    });

                    if (res.isChanged) {
                        changed++;
                    }

                    res.merged.lastSeen = res.merged.lastSeen || new Date(now - idx).toISOString();
                    res.merged.source = source || (old && old.source) || 'unknown';
                    res.merged.accountSlot = slot;

                    map.set(nid, res.merged);
                });

                const merged = Array.from(map.values());
                merged.sort(compareConversations);

                if (!forceWrite && changed === 0) return null;
                return { list: merged, changed };
            });

            const mergedLength = tx.list.length;
            if (!tx.written) {
                if (__lastKnownCount !== mergedLength) {
                    updateBadge(mergedLength, incomingItems.length);
                    __lastKnownCount = mergedLength;
                }
                return mergedLength;
            }

            await Storage.setLastSync(slot, Date.now(), mergedLength);
            const profile = sniffUserProfileFromDom();
            const slotUpdate: Record<string, any> = {
                slot,
                count: mergedLength,
                lastSync: new Date().toISOString()
            };
            if (profile?.accountId) slotUpdate.accountId = profile.accountId;
            if (profile?.email) slotUpdate.email = profile.email;
            if (profile?.name) slotUpdate.name = profile.name;
            if (profile?.gaiaId) slotUpdate.gaiaId = profile.gaiaId;
            await Storage.updateAccountSlot(slot, slotUpdate);

            try {
                const p = chrome.runtime.sendMessage({
                    action: 'syncUpdate',
                    slot,
                    count: mergedLength,
                    from: source
                });
                if (p && p.catch) p.catch(() => {});
            } catch (e) {
                if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
            }

            updateBadge(mergedLength, incomingItems.length);
            __lastKnownCount = mergedLength;
            return mergedLength;
        } catch (e: unknown) {
            const errMsg = getErrorMessage(e);
            if (errMsg.includes('Extension context invalidated')) return 0;
            console.error('[Gemini Exporter] upsertConversations failed', e);
        }
    });
    return __storageWriteQueue;
}

export interface IngestListResult {
    count: number;
    reachedWatermark: boolean;
    establishedBaseline: boolean;
    newWatermark: number | null;
}

export interface IngestListOptions {
    slot?: string;
    isPage1?: boolean;
    isFullScanComplete?: boolean;
    forceFull?: boolean;
    /**
     * Phase A (P1-3): 只有扫描控制面才参与 watermark/slice。
     * 默认为 false —— 嗅探（数据面）只写数据，不碰 __sessionSlices、不推进 checkpoint。
     * 只有 onPageBatch / 完整扫描收尾显式传 true。
     */
    participateInWatermark?: boolean;
}

interface SessionSlice {
    headTimestamp: number;
    minTimestamp: number;
    updatedAt: number;
}

const __sessionSlices = new Map<string, SessionSlice>();

export function resetSessionSlice(slot?: string): void {
    const s = slot || getAccountSlot();
    __sessionSlices.delete(s);
}

export async function ingestListBatch(
    incomingItems: any[],
    source: string,
    options?: IngestListOptions
): Promise<IngestListResult> {
    const slot = options?.slot || getAccountSlot();
    const Storage = getStorage();
    // Phase A (P1-3): 嗅探是数据面，默认不参与 watermark/slice
    const participateInWatermark = options?.participateInWatermark === true;

    // 1. Full scan completion notification: establish initial baseline or recalibrate baseline
    // (仅扫描控制面参与)
    if (participateInWatermark && options?.isFullScanComplete) {
        const slice = __sessionSlices.get(slot);
        let baselineTs: number | null = null;
        if (slice && slice.headTimestamp > 0) {
            baselineTs = slice.headTimestamp;
        } else if (incomingItems && incomingItems.length > 0) {
            const tsList = incomingItems.map((c: any) => c.timestamp).filter((t: any) => typeof t === 'number' && t > 0);
            if (tsList.length > 0) baselineTs = Math.max(...tsList);
        } else {
            // Empty account: natural completion of full scan with 0 conversations anchors baseline to current time
            baselineTs = Date.now();
        }
        if (baselineTs && Storage && typeof Storage.setScanCheckpoint === 'function') {
            await Storage.setScanCheckpoint(slot, baselineTs);
            console.log(`[Gemini Exporter] Watermark Baseline established at ${new Date(baselineTs).toISOString()} (${baselineTs}) for slot ${slot}`);
        }
        __sessionSlices.delete(slot);
        return {
            count: incomingItems?.length || 0,
            reachedWatermark: true,
            establishedBaseline: true,
            newWatermark: baselineTs
        };
    }

    // 2. Write conversations to storage via Fail-Closed upsert
    const count = await upsertConversations(incomingItems, source, true, slot);

    // Phase A (P1-3): 嗅探（数据面）到此为止 —— 不进 slice、不碰 checkpoint。
    // 下面的 3-5 步是扫描控制面的水位逻辑。
    if (!participateInWatermark) {
        const currentCp = Storage && typeof Storage.getScanCheckpoint === 'function'
            ? await Storage.getScanCheckpoint(slot)
            : null;
        return { count, reachedWatermark: false, establishedBaseline: false, newWatermark: currentCp };
    }

    // 3. Extract timestamps of valid items in this batch
    const timestamps = (incomingItems || [])
        .map((c: any) => c.timestamp)
        .filter((t: any): t is number => typeof t === 'number' && t > 0);

    if (timestamps.length === 0) {
        const currentCp = Storage && typeof Storage.getScanCheckpoint === 'function'
            ? await Storage.getScanCheckpoint(slot)
            : null;
        return { count, reachedWatermark: false, establishedBaseline: false, newWatermark: currentCp };
    }

    const batchMax = Math.max(...timestamps);
    const batchMin = Math.min(...timestamps);
    const now = Date.now();

    // 4. Track contiguous paging session
    let slice = __sessionSlices.get(slot);
    const isSliceActive = slice && (now - slice.updatedAt < 120000);

    if (options?.isPage1 || !isSliceActive || !slice) {
        slice = { headTimestamp: batchMax, minTimestamp: batchMin, updatedAt: now };
        __sessionSlices.set(slot, slice);
    } else {
        // Multi-page chaining: subsequent pages in descending chronological order
        // extend the contiguous paging interval downwards.
        if (batchMax <= slice.headTimestamp + 60000) {
            slice.minTimestamp = Math.min(slice.minTimestamp, batchMin);
            slice.headTimestamp = Math.max(slice.headTimestamp, batchMax);
            slice.updatedAt = now;
        } else {
            slice = { headTimestamp: batchMax, minTimestamp: batchMin, updatedAt: now };
            __sessionSlices.set(slot, slice);
        }
    }

    // 5. Watermark Checkpoint Evaluation
    const currentCheckpoint = Storage && typeof Storage.getScanCheckpoint === 'function'
        ? await Storage.getScanCheckpoint(slot)
        : null;

    // Cold start: no baseline established yet! In this state, NEVER advance or create checkpoint during mid-scan or sniffing.
    if (currentCheckpoint === null) {
        return {
            count,
            reachedWatermark: false,
            establishedBaseline: false,
            newWatermark: null
        };
    }

    // Forced full scan running: don't early exit on watermark
    if (options?.forceFull) {
        return {
            count,
            reachedWatermark: false,
            establishedBaseline: false,
            newWatermark: currentCheckpoint
        };
    }

    // Check if the contiguous slice has reached or crossed the current checkpoint strictly (no tolerance deadzone)
    if (slice.minTimestamp <= currentCheckpoint) {
        const newWatermark = Math.max(currentCheckpoint, slice.headTimestamp);
        if (newWatermark > currentCheckpoint && Storage && typeof Storage.setScanCheckpoint === 'function') {
            await Storage.setScanCheckpoint(slot, newWatermark);
            console.log(`[Gemini Exporter] Watermark advanced from ${new Date(currentCheckpoint).toISOString()} to ${new Date(newWatermark).toISOString()} (${newWatermark}) for slot ${slot}`);
        }
        return {
            count,
            reachedWatermark: true,
            establishedBaseline: false,
            newWatermark
        };
    }

    return {
        count,
        reachedWatermark: false,
        establishedBaseline: false,
        newWatermark: currentCheckpoint
    };
}

export async function syncOnce(): Promise<number> {
    if (__syncOnceInFlight) return 0;
    __syncOnceInFlight = true;
    try {
        const items: any[] = [];
        // 1. Check current active page chat
        const activeId = typeof location !== 'undefined' ? extractConversationIdFromUrl(location.pathname) : null;
        if (activeId) {
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
    } finally {
        __syncOnceInFlight = false;
    }
}

/**
 * 决定本次会话列表同步用增量还是全量 —— 还原为增量最根本的语义。
 *
 * 增量 = 从新往旧连续扫描，直到本轮连续摄入区间与历史水位线闭环咬合才停。
 * 停止判定在 ingestListBatch 里做（slice.minTimestamp <= checkpoint 时停并推进
 * checkpoint）。旧的"连续 5 条未变化就停"分页兜底已被删除，
 * 唯一的停止机制就是水位闭环。
 *
 * 不再做基线预判：无基线时所有条目都会被判"有变化"，扫描自然走到服务端
 * 尽头才停，等价于一次全量 —— 用条数 proxy 时间戳存在性的基线检查是多余的。
 * 也不再给增量设单独的小页数上限：上限只防死循环（服务端游标异常导致永不
 * 收敛），与全量取同一上限，正常流程永远碰不到。
 */
export function resolveListSyncMode(
    forceOpts?: { forceFull?: boolean; maxPages?: number }
): { useIncremental: boolean; maxPages: number } {
    const useIncremental = !forceOpts?.forceFull;
    return {
        useIncremental,
        maxPages: forceOpts?.maxPages || 2000,
    };
}

export async function tryBatchExecuteFull(forceOpts?: { forceFull?: boolean; maxPages?: number }): Promise<any> {
    if (contentContext.getDeepScanPromise()) return null;

    let _resolve: (() => void) | undefined;
    const scanPromise = new Promise<void>(r => { _resolve = r; });
    contentContext.setDeepScanPromise(scanPromise);

    try {
        document.getElementById('geminiExportBadge')?.classList.add('syncing');
        const provider = resolveProvider();
        if (!provider) return null;
        // The provider owns the request lifecycle now; ActiveClientContract is
        // all-optional so this stays type-safe. Cancel still terminates the
        // scan: messageRouter sets window.__gemExporterAborted on stop, which
        // the pagination loop checks every page.
        contentContext.setActiveClient(provider);
        contentContext.setAborted(false);

        const slot = getAccountSlot();
        resetSessionSlice(slot);
        const Storage = getStorage();
        const { maxPages: effectiveMaxPages } = resolveListSyncMode(forceOpts);

        const currentCheckpoint = Storage && typeof Storage.getScanCheckpoint === 'function'
            ? await Storage.getScanCheckpoint(slot)
            : null;
        const isForceFull = !!forceOpts?.forceFull;
        const effectiveForceFull = isForceFull || (currentCheckpoint === null);

        let stoppedByWatermark = false;
        let page1Batch: any[] = [];
        // Typed as any: the registered Gemini provider spreads the full pagination
        // result (conversations/hitGoogleLimit/diagnostics) into the page shape
        // at runtime; the provider-neutral declared type is still stabilizing.
        const all: any = await provider.listConversations({
            maxPages: effectiveMaxPages,
            forceFull: effectiveForceFull,
            onPageBatch: async (batch: any[], info: { page: number; hasMore: boolean }) => {
                if (info.page === 1) {
                    page1Batch = batch;
                }
                const ingestRes = await ingestListBatch(batch, 'batchexecute', {
                    slot,
                    isPage1: info.page === 1,
                    forceFull: effectiveForceFull,
                    // Phase A (P1-3): 扫描控制面参与 watermark/slice
                    participateInWatermark: true
                });

                if (!effectiveForceFull && ingestRes.reachedWatermark) {
                    stoppedByWatermark = true;
                    return {
                        shouldStop: true,
                        reason: '已与历史水位线闭环咬合，增量同步完成'
                    };
                }
            },
            onProgress: (prog: any) => {
                const zh = isZh();
                const badge = document.getElementById('geminiExportBadgeText');
                if (badge) {
                    if (prog.stoppedEarly) {
                        badge.textContent = zh ? `已同步 ${prog.total} 条 ✓` : `${prog.total} synced ✓`;
                    } else {
                        badge.textContent = zh ? `正在同步: 已获取 ${prog.total} 条${prog.hasMore ? '…' : ''}` : `Syncing: ${prog.total} fetched${prog.hasMore ? '…' : ''}`;
                    }
                }
                try {
                    const page = prog.page || 1;
                    const estPercent = prog.hasMore ? Math.min(5 + page * 2, 95) : 98;
                    const progressTitle = zh
                        ? `正在同步第 ${page} 页 (已获取 ${prog.total} 条)${prog.hasMore ? '…' : ''}`
                        : `Syncing page ${page} (${prog.total} fetched)${prog.hasMore ? '…' : ''}`;
                    const _p = chrome.runtime.sendMessage({
                        action: 'scanProgress',
                        done: page,
                        count: prog.total,
                        percent: estPercent,
                        title: progressTitle
                    });
                    if (_p && _p.catch) _p.catch(() => {});
                } catch (e) {
                    if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
                }
            },
            targetSid: null,
            incremental: !effectiveForceFull
        });

        // If this was a full scan that finished naturally (not stopped by watermark, not aborted)
        if (effectiveForceFull && !stoppedByWatermark && !contentContext.isAborted()) {
            await ingestListBatch(page1Batch, 'batchexecute', {
                slot,
                isFullScanComplete: true,
                forceFull: isForceFull,
                // Phase A (P1-3): 扫描收尾建立水位基线，属于控制面
                participateInWatermark: true
            });
        }

        if (all && all.diagnostics) {
            try {
                await chrome.storage.local.set({ [STORAGE_KEYS.LAST_SYNC_DIAGNOSTICS]: all.diagnostics });
            } catch (e) { console.warn('[GemExporter:storage] Storage operation failed:', e); }
        }

        if (all && all.conversations && all.conversations.length) {
            // Each page batch was already incrementally upserted via onPageBatch;
            // avoid a second full O(n log n) pass here.
            let mergedLen = all.conversations.length;
            // Absence from the fetched list only proves deletion when the listing is
            // provably complete. A Google ~600 sliding-window limit means the tail was
            // never fetched — reconciling against it would mass-delete still-alive
            // older conversations, so the limit case must skip reconciliation.
            const hitLimit = !!(all?.hitGoogleLimit || all?.diagnostics?.hitGoogleLimit);
            const isFullExhaustive = effectiveForceFull && !all.stoppedEarly && !contentContext.isAborted() && !hitLimit;
            if (isFullExhaustive && Storage && typeof Storage.reconcileConversations === 'function') {
                const recRes = await Storage.reconcileConversations(slot, all.conversations, { keepTakeout: true });
                if (recRes && recRes.removed > 0) {
                    console.log(`[Gemini Exporter] Reconciled with cloud: pruned ${recRes.removed} deleted conversations`, recRes.removedIds);
                    mergedLen = recRes.kept;
                }
            }
            const Proto = getProtocol();
            const slidingLimit = Proto?.LIMITS?.SLIDING_WINDOW || 600;
            const isLimit = !!(all?.hitGoogleLimit || all?.diagnostics?.hitGoogleLimit || (effectiveForceFull && mergedLen >= slidingLimit));
            const zh = isZh();
            const badge = document.getElementById('geminiExportBadgeText');
            if (badge) badge.textContent = zh ? `已同步 ${mergedLen} 条 ✓` : `${mergedLen} synced ✓`;
            if (isLimit && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                try {
                    const existing = await chrome.storage.local.get([STORAGE_KEYS.HAS_COMPLETED_TAKEOUT_PROMPT]);
                    if (!existing?.[STORAGE_KEYS.HAS_COMPLETED_TAKEOUT_PROMPT]) {
                        chrome.storage.local.set({
                            [STORAGE_KEYS.PENDING_TAKEOUT_PROMPT]: {
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
                const completeTitle = zh ? `同步完成，共 ${mergedLen} 条` : `Sync completed, ${mergedLen} in total`;
                const _p = chrome.runtime.sendMessage({
                    action: 'scanProgress',
                    done: 1,
                    total: 1,
                    percent: 100,
                    count: mergedLen,
                    hitGoogleLimit: isLimit,
                    title: completeTitle
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
    } catch (e: unknown) {
        const errMsg = getErrorMessage(e);
        if (contentContext.isDevMode()) console.debug('[Gemini Exporter] batch exec fail', errMsg);
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
    touchActiveConversation,
    upsertConversations,
    ingestListBatch,
    resetSessionSlice,
    syncOnce,
    tryBatchExecuteFull,
    compareConversations
};


export default SyncEngine;
