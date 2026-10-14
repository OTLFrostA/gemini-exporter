import type { PageObservation } from '../core/sync/pageObservation.js';
import { isStoredObject, type StoredValue } from '../core/storage/storageCompatibility.js';
import type { ScanCoverageRun, ScanCoverage } from '../core/storage/scanCoverage.js';
import type { ScanStatus } from '../types/ui.js';
import type { ApplicationProvider } from "./providerCompatibility.js";
import type { GeminiProviderConversationItem, GeminiProviderPageResult } from "../core/provider/gemini/geminiContracts.js";
import type { GeminiPaginationDiagnostics } from "../core/api/client/pagination.js";
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
    deduplicateConversations,
    normalizeReliableTitleSource
} from '../core/utils/utils.js';
import { STORAGE_KEYS } from '../core/utils/constants.js';
import { resolveProvider } from '../core/provider/providerResolver.js';
import { detectSlotFromUrl, extractConversationIdFromUrl, normId, isReservedRoute } from '../core/utils/pathUtils.js';
import { assertSchemaWritable } from '../core/storage/schemaMigration.js';
import { sniffUserProfileFromDom } from './accountSniffer.js';
import { isPaginationExhaustive } from '../core/api/client/pagination.js';

const getStorage = () => __resolveModule('StorageService', StorageService);
const getScraper = () => DomScraper;
const getBadge = () => BadgeView;

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

const confirmedDeleted = new Map<string, Set<string>>();
/** A still-open deleted page cannot reintroduce its stale sidebar/title observations. */
export function markConfirmedDeleted(slot: string, id: string): void {
    const ids = confirmedDeleted.get(slot) ?? new Set<string>();
    ids.add(normId(id)); confirmedDeleted.set(slot, ids);
}

export function getAccountSlot(): string {
    return detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined);
}

export function updateBadge(mergedLen?: StoredValue, visible?: number, overrideText?: string, isSyncing = false): void {
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
        updateBadge(convs.length, 0);
    } catch (e) {
        if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine] refreshInitialBadge error', e);
    }
}

export function extractActiveChatTitle(activeId: string): { title: string; source: string } | null {
    if (!activeId || typeof document === 'undefined') return null;
    const titleEls = document.querySelectorAll('[data-test-id="conversation-title"], .conversation-title, h1, [class*="conversation-title"]');
    for (const el of Array.from(titleEls)) {
        const t = cleanTitle(el.textContent || '');
        if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
    }
    const activeLink = document.querySelector(`a[href*="${activeId}"]`);
    if (activeLink) {
        const t = cleanTitle(activeLink.querySelector('.title, [class*="title"]')?.textContent || activeLink.textContent || '');
        if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
    }
    if (document.title) {
        const t = cleanTitle(document.title);
        if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
    }
    const firstUserQuery = document.querySelector('user-query .query-text, user-query [data-test-id="query-text"], user-query p, user-query');
    if (firstUserQuery) {
        const t = cleanTitle((firstUserQuery.textContent || '').trim().slice(0, 60).replace(/\n+/g, ' '));
        if (isRealTitle(t, activeId)) return { title: t, source: 'sniff' };
    }
    return null;
}

const __fetchingDetailMap = new Map<string, number>();
export function scheduleActiveChatDetailFetch(activeId: string, options?: { force?: boolean }): void {
    if (!activeId) return;
    if (!options?.force && __fetchingDetailMap.has(activeId)) return;
    __fetchingDetailMap.set(activeId, Date.now());
    setTimeout(async () => {
        try {
            const slot = getAccountSlot();
            const Storage = getStorage();
            const existing = Storage ? await Storage.getConversations(slot) : [];
            const rawFound = existing.find((c: any) => normId(c.id) === activeId);
            const found = isStoredObject(rawFound) && !Array.isArray(rawFound) ? rawFound : null;
            const hasResolvedTitle = found && isRealTitle(typeof found.title === 'string' ? found.title : undefined, activeId)
                && found.titleSource !== 'sniff' && found.titleSource !== 'default';
            if (!options?.force && hasResolvedTitle && (found.updatedAt || found.timestamp)) {
                return;
            }

            const provider = resolveProvider() as ApplicationProvider | undefined;
            if (!provider) return;
            const native = await provider.fetchConversationDetail(activeId);
            const d = native.conversation;
            if (d && d.id) {
                const nid = normId(d.id);
                const targetTs = d.updatedAt ?? null;
                if (targetTs) {
                    await upsertConversations([{
                        id: nid,
                        title: d.title,
                        titleSource: d.titleSource || 'rpc',
                        url: d.url || `https://gemini.google.com/app/${nid}`,
                        href: d.url || `https://gemini.google.com/app/${nid}`,
                        timestamp: targetTs,
                        updatedAt: targetTs,
                        createdAt: d.createdAt || null,
                        messageCount: d.messages.length
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
    const item: any = {
        id: nid,
        url: `https://gemini.google.com/app/${nid}`,
        href: `https://gemini.google.com/app/${nid}`,
        sidebarIndex: 0
    };

    if (activeTitleObj && activeTitleObj.title && isRealTitle(activeTitleObj.title, nid)) {
        const cleanT = cleanTitle(activeTitleObj.title);
        const sourceTier = normalizeReliableTitleSource(activeTitleObj.source) || 'dom';
        item.title = cleanT;
        item.titleSource = sourceTier;
        item.titles = { [sourceTier]: cleanT };
    }

    if (typeof document !== 'undefined') {
        const count = document.querySelectorAll('user-query, model-response').length;
        if (count > 0) item.messageCount = count;
    }

    const source = options?.source || 'stream-complete';
    const res = await upsertConversations([item], source, options?.forceWrite ?? true, targetSlot);

    if (source === 'stream-complete' || source === 'live-turn-complete') {
        scheduleActiveChatDetailFetch(nid, { force: true });
    }

    return res;
}

export interface RpcListIngestResult {
    count: number;
    accepted: number;
    rejected: number;
    persisted: number;
}

const emptyIngest = (rejected = 0): RpcListIngestResult => ({ count: 0, accepted: 0, rejected, persisted: 0 });
let __storageWriteQueue = Promise.resolve<RpcListIngestResult>(emptyIngest());
let __lastKnownCount = 0;
let __syncOnceInFlight = false;

export function upsertConversations(incomingItems: any[], source: string, forceWrite = false, targetSlot: string | null = null): Promise<number> {
    return persistConversationBatch(incomingItems, source, forceWrite, targetSlot).then(result => result.count);
}

/** Both RPC acquisition paths commit through the same merge and storage transaction. */
export async function ingestRpcList(items: GeminiProviderConversationItem[], slot: string): Promise<RpcListIngestResult> {
    await assertSchemaWritable();
    return persistConversationBatch(items, 'network-list', true, slot);
}

/** Both passive and active pages pass through this trigger-independent boundary. */
export async function ingestPageObservation(page: PageObservation<GeminiProviderConversationItem>, slot: string,
    runId?: string): Promise<RpcListIngestResult> {
    const Storage = getStorage();
    const canCommit = () => (typeof location === 'undefined' || getAccountSlot() === slot)
        && (page.accountId === null || sniffUserProfileFromDom()?.accountId === page.accountId)
        && (runId !== undefined || page.requestedAt > contentContext.getCancelledAt())
        && (runId === undefined || !contentContext.isAborted());
    if (!canCommit()) throw new Error('Page observation belongs to a stale account or cancelled request');
    if (page.accountId === null) return ingestRpcList(page.items, slot);
    const context: ScanCoverage = await Storage.preparePageCoverage(slot, page.accountId, page.providerId);
    const receipt = await ingestRpcList(page.items, slot);
    if (receipt.rejected > 0 || receipt.persisted !== receipt.accepted) return receipt;
    if (!await Storage.recordPageCoverage(slot, page, context, page.streamId === 'recent', ['pinned', 'recent'], runId, canCommit)
        && runId !== undefined) throw new Error('Coverage was cleared, cancelled or superseded');
    return receipt;
}

function persistConversationBatch(incomingItems: any[], source: string, forceWrite = false, targetSlot: string | null = null): Promise<RpcListIngestResult> {
    if (!incomingItems || !incomingItems.length) return Promise.resolve(emptyIngest());

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
        return Promise.resolve(emptyIngest(incomingItems.length));
    }

    __storageWriteQueue = __storageWriteQueue.catch(() => emptyIngest()).then(async () => {
        try {
            const slot = targetSlot || getAccountSlot();
            const Storage = getStorage();
            if (!Storage) throw new Error('Conversation storage unavailable');
            const now = Date.now();

            // Cross-tab: read + merge + write run atomically inside the storage
            // transaction. The old shape read outside the lock, so two tabs
            // could build on the same stale snapshot and the later write would
            // silently discard the earlier tab's updates (lost update).
            let accepted = 0;
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
                    if (confirmedDeleted.get(slot)?.has(nid)) return;
                    c.id = nid;
                    const old = map.get(nid);
                    if (old?.cloudAvailability === 'deleted') return;
                    accepted++;

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

                    if (old?.cloudAvailability === 'unlisted' && (source === 'batchexecute' || source === 'network-list')) res.merged.cloudAvailability = undefined;
                    map.set(nid, res.merged);
                });

                const merged = Array.from(map.values());
                merged.sort(compareConversations);

                if (!forceWrite && changed === 0) return null;
                return { list: merged, changed };
            });

            const mergedLength = tx.list.length;
            const result: RpcListIngestResult = { count: mergedLength, accepted,
                rejected: incomingItems.length - accepted, persisted: tx.written ? accepted : 0 };
            if (!tx.written) {
                if (__lastKnownCount !== mergedLength) {
                    updateBadge(mergedLength, incomingItems.length);
                    __lastKnownCount = mergedLength;
                }
                return result;
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
            return result;
        } catch (e: unknown) {
            console.error('[Gemini Exporter] upsertConversations failed', e);
            throw e;
        }
    });
    return __storageWriteQueue;
}

export async function syncOnce(): Promise<number> {
    if (__syncOnceInFlight) return 0;
    __syncOnceInFlight = true;
    try {
        const items: any[] = [];
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

        const Scraper = getScraper();
        if (Scraper && typeof Scraper.getConversationLinks === 'function') {
            const links = Scraper.getConversationLinks() || [];
            items.push(...links);
        }

        if (!items.length) return 0;
        const resLen = await upsertConversations(items, 'page-sync');

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

export interface ProviderSyncResult {
    count: number;
    diagnostics: GeminiPaginationDiagnostics;
    hitGoogleLimit: boolean;
    status: ScanStatus;
    error?: string;
}

function scanStatus(all: GeminiProviderPageResult, verifiedIncrementalStop = false): ScanStatus {
    if (contentContext.isAborted() || all.completionReason === 'aborted') return 'aborted';
    if (all.hitGoogleLimit || all.diagnostics?.hitGoogleLimit || all.completionReason === 'hit_google_limit') return 'partial_limit';
    if (verifiedIncrementalStop && all.completionReason === 'unchanged_boundary') return 'up_to_date';
    if (all.exhaustive === true && all.completionReason === 'natural_exhaustion' && isPaginationExhaustive(all)) return 'complete';
    return 'error';
}

export async function syncConversations(options?: { maxPages?: number }): Promise<ProviderSyncResult | null> {
    if (contentContext.getDeepScanPromise()) return null;

    let _resolve: (() => void) | undefined;
    const scanPromise = new Promise<void>(r => { _resolve = r; });
    contentContext.setDeepScanPromise(scanPromise);

    const slot = getAccountSlot();
    const Storage = getStorage();
    let coverageRun: ScanCoverageRun | null = null;
    let coverageFinished = false;
    try {
        document.getElementById('geminiExportBadge')?.classList.add('syncing');
        const provider = resolveProvider() as ApplicationProvider | undefined;
        if (!provider) return null;
        // The provider owns the request lifecycle now; ActiveClientContract is
        // all-optional so this stays type-safe. Cancel still terminates the
        // scan: messageRouter sets window.__gemExporterAborted on stop, which
        // the pagination loop checks every page.
        contentContext.setActiveClient(provider);
        contentContext.setAborted(false);

        const accountId = sniffUserProfileFromDom()?.accountId ?? null;
        coverageRun = await Storage.beginScanCoverage(slot, accountId);
        const runId = coverageRun.runId;
        const effectiveMaxPages = options?.maxPages || 2000;
        let expectedPage = 1;
        const previousRecent = coverageRun.previous?.streams.recent;
        const incremental = previousRecent?.initialized === true && !!previousRecent.range && !previousRecent.orderingInvalidated;
        let recentHead: PageObservation<GeminiProviderConversationItem> | null = null;
        let verifiedIncrementalStop = false;
        // Pinned is unordered and scanned independently. Recent closes against
        // frozen activity coverage; renames without activity may remain stale.
        const all: GeminiProviderPageResult = await provider.listConversations({
            maxPages: effectiveMaxPages,
            includePinned: true,
            onPageBatch: async (batch, info) => {
                if (getAccountSlot() !== slot || (accountId !== null && sniffUserProfileFromDom()?.accountId !== accountId)) {
                    throw new Error('Account changed during sync; retry in the current account');
                }
                if (contentContext.isAborted()) throw new Error('Sync aborted');
                if (info.page !== expectedPage++ || !await Storage.isScanCoverageCurrent(slot, runId)) {
                    throw new Error('Sync was superseded or pagination is not contiguous; retry');
                }
                await assertSchemaWritable();
                const page = info.observation ? { ...info.observation, accountId } : null;
                const receipt = page ? await ingestPageObservation(page, slot, runId) : await ingestRpcList(batch, slot);
                if (receipt.rejected > 0 || receipt.persisted !== receipt.accepted) {
                    throw new Error('List page could not be fully persisted; coverage was not advanced');
                }
                if (page?.streamId === 'recent' && page.requestKnown && page.valid && page.ordered) {
                    if (page.requestCursor === null) recentHead = page;
                    if (incremental && previousRecent && recentHead && await Storage.hasScanCoverageOverlap(slot, runId, recentHead, previousRecent,
                        () => !contentContext.isAborted() && getAccountSlot() === slot
                            && (accountId === null || sniffUserProfileFromDom()?.accountId === accountId))) {
                        verifiedIncrementalStop = true;
                        return { shouldStop: true, reason: 'Connected to verified activity coverage' };
                    }
                }
            },
            onProgress: (prog) => {
                const zh = isZh();
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
            incremental
        });

        // Google-specific diagnostic/UI evidence stays at this Gemini consumer boundary.
        const diagnostics: GeminiPaginationDiagnostics = all?.diagnostics;
        const hitGoogleLimit = !!(all?.hitGoogleLimit || diagnostics?.hitGoogleLimit);
        if (all && diagnostics) {
            const setDiag = Storage?.setLastSyncDiagnostics || StorageService.setLastSyncDiagnostics;
            await setDiag(diagnostics);
        }

        const finalStatus = scanStatus(all, verifiedIncrementalStop);
        const timestamps = all.items.map(item => item.timestamp).filter((ts): ts is number =>
            typeof ts === 'number' && Number.isFinite(ts) && ts > 0);
        const baseline = finalStatus === 'complete' ? {
            headTimestamp: timestamps.length ? timestamps.reduce((max, ts) => Math.max(max, ts), 0) : null,
            conversationCount: all.items.length
        } : null;
        if (!await Storage.finishScanCoverage(slot, runId, finalStatus, baseline, all.items.map(item => item.id),
            () => !contentContext.isAborted() && getAccountSlot() === slot
                && (accountId === null || sniffUserProfileFromDom()?.accountId === accountId))) {
            throw new Error('Sync was superseded or local history was cleared; retry');
        }
        coverageFinished = true;

        if (hitGoogleLimit && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const existing = await chrome.storage.local.get([STORAGE_KEYS.HAS_COMPLETED_TAKEOUT_PROMPT]);
                if (!existing?.[STORAGE_KEYS.HAS_COMPLETED_TAKEOUT_PROMPT]) {
                    // Persist STORAGE_KEYS.PENDING_TAKEOUT_PROMPT via StorageService
                    const setPending = Storage?.setPendingTakeoutPrompt || StorageService.setPendingTakeoutPrompt;
                    await setPending({
                        slot,
                        count: all.items.length,
                        hitGoogleLimit: hitGoogleLimit,
                        timestamp: Date.now()
                    });
                }
            } catch (e) {
                if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
            }
        }
        if (all && all.items && all.items.length) {
            // Each page batch was already incrementally upserted via onPageBatch;
            // avoid a second full O(n log n) pass here.
            const mergedLen = all.items.length;
            const isLimit = hitGoogleLimit;
            const zh = isZh();
            const status = finalStatus;
            const complete = status === 'complete' || status === 'up_to_date';
            const incompleteReason = status === 'partial_limit'
                ? (zh ? '已达服务端限制' : 'server limit reached')
                : status === 'aborted' ? (zh ? '已停止' : 'stopped') : (zh ? '出现错误' : 'an error occurred');
            const finishText = complete
                ? status === 'up_to_date'
                    ? (zh ? `增量同步完成，本次检查 ${mergedLen} 条` : `Sync up to date, ${mergedLen} checked`)
                    : (zh ? `同步完成，共 ${mergedLen} 条` : `Sync completed, ${mergedLen} in total`)
                : (zh ? `同步未完成，已保存 ${mergedLen} 条，可重试（${incompleteReason}）` : `Sync incomplete: ${mergedLen} saved; retry (${incompleteReason})`);
            try {
                const completeTitle = finishText;
                const _p = chrome.runtime.sendMessage({
                    action: 'scanProgress',
                    done: complete ? 1 : 0,
                    total: 1,
                    percent: complete ? 100 : 0,
                    count: mergedLen,
                    hitGoogleLimit: isLimit,
                    status,
                    title: completeTitle
                });
                if (_p && _p.catch) _p.catch(() => {});
            } catch (e) {
                if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine]', e);
            }
            return { count: mergedLen, diagnostics, hitGoogleLimit: isLimit, status,
                ...(complete ? {} : { error: diagnostics.stopReason || status }) };
        }
        if (all && diagnostics) {
            const status = finalStatus;
            return { count: 0, diagnostics, hitGoogleLimit, status,
                ...(['complete', 'up_to_date'].includes(status) ? {} : { error: diagnostics.stopReason || status }) };
        }
    } catch (e: unknown) {
        if (coverageRun && !coverageFinished) {
            try { await Storage.finishScanCoverage(slot, coverageRun.runId, contentContext.isAborted() ? 'aborted' : 'error'); }
            catch (coverageError) { console.error('[Gemini Exporter] Could not record failed scan', coverageError); }
        }
        const errMsg = getErrorMessage(e);
        if (contentContext.isDevMode()) console.debug('[Gemini Exporter] batch exec fail', errMsg);
        throw e;
    } finally {
        // The floating badge reports stored conversations; scan outcomes stay in workbench messages.
        await refreshInitialBadge();
        document.getElementById('geminiExportBadge')?.classList.remove('syncing');
        contentContext.setActiveClient(null);
        contentContext.setDeepScanPromise(null);
        if (_resolve) _resolve();
    }
    return null;
}

export const SyncEngine = {
    markConfirmedDeleted,
    getAccountSlot,
    isZh,
    setLanguage,
    updateBadge,
    refreshInitialBadge,
    extractActiveChatTitle,
    scheduleActiveChatDetailFetch,
    touchActiveConversation,
    upsertConversations,
    ingestRpcList,
    ingestPageObservation,
    syncOnce,
    syncConversations,
    compareConversations
};


export default SyncEngine;
