import { persistConversationBatch, markConfirmedDeleted, upsertConversations, ingestRpcList, ingestPageObservation } from './geminiIndexCapture.js';
export { markConfirmedDeleted, upsertConversations, ingestRpcList, ingestPageObservation } from './geminiIndexCapture.js';
import CoverageAdmission, { type ScanHead } from '../core/domain/coverageAdmission.js';
import ScanLifecycle from '../core/application/sync/scanLifecycle.js';
import { setConversationAvailability } from '../core/storage/conversationAvailability.js';
import { isAccountId } from '../core/domain/accountRegistry.js';
import { type DomainConversationIndex } from '../core/domain/conversationIndex.js';
import { parseGeminiDomIndex } from '../core/parsers/gemini/dom/parseIndex.js';
import { type StoredValue } from '../core/storage/storageCompatibility.js';
import type { ScanRun } from '../core/application/sync/scanLifecycle.js';
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
    deduplicateConversations
} from '../core/utils/utils.js';
import { STORAGE_KEYS } from '../core/utils/constants.js';
import { resolveProvider } from '../core/provider/providerResolver.js';
import { detectSlotFromUrl, extractConversationIdFromUrl, normId, isReservedRoute } from '../core/utils/pathUtils.js';
import { assertSchemaWritable } from '../core/storage/schemaMigration.js';
import { sniffUserProfileFromDom } from './accountSniffer.js';
import { resolveCurrentAccount, isCurrentAccount, getAccountContext } from './accountContext.js';
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
        const convs = Storage ? await Storage.getConversations((await resolveCurrentAccount())?.accountId) : [];
        updateBadge(convs.length, 0);
    } catch (e) {
        if (contentContext.isDevMode()) console.debug('[GemExporter:syncEngine] refreshInitialBadge error', e);
    }
}

export function extractActiveChatTitle(activeId: string): { title: string; source: string } | null {
    if (!activeId || typeof document === 'undefined') return null;
    const index = parseGeminiDomIndex(document, activeId);
    return index.title ? { title: index.title, source: index.titleSource ?? "derived" } : null;
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
            const existing = Storage ? await Storage.getConversations((await resolveCurrentAccount())?.accountId) : [];
            const found = existing.find(c => c.key.conversationId === activeId);
            const hasResolvedTitle = found && Boolean(found.title)
                && found.titleSource !== 'derived';
            if (!options?.force && hasResolvedTitle && found.updatedAt !== undefined) {
                return;
            }

            const provider = resolveProvider() as ApplicationProvider | undefined;
            if (!provider) return;
            const account = await resolveCurrentAccount();
            if (!account || account.slot !== slot) return;
            const native = await provider.fetchConversationDetail(activeId, { slot, accountId: account.accountId });
            const fresh = await resolveCurrentAccount();
            if (fresh?.accountId !== account.accountId || !isCurrentAccount(account)) return;

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

    const account = await resolveCurrentAccount();
    if (!account || slot && slot !== account.slot && slot !== account.accountId) return 0;
    const touchKey = JSON.stringify([account.accountId, nid]);
    const now = Date.now();
    const lastTouched = __lastTouchedMap.get(touchKey) || 0;
    if (!options?.forceWrite && (now - lastTouched < 800)) {
        return 0;
    }
    __lastTouchedMap.set(touchKey, now);
    pruneLastTouchedMap(now);

    const targetSlot = account.accountId;
    const item = parseGeminiDomIndex(typeof document === 'undefined' ? null : document, nid);

    const source = options?.source || 'stream-complete';
    // Submit source facts only; no local clock or UI hint enters Domain.
    const receipt = await persistConversationBatch([item], source, targetSlot, now, () => isCurrentAccount(account));
    const res = receipt.count;

    if (source === 'stream-complete' || source === 'live-turn-complete') {
        scheduleActiveChatDetailFetch(nid, { force: true });
    }

    return res;
}

let __syncOnceInFlight = false;

export async function syncOnce(): Promise<number> {
    if (__syncOnceInFlight) return 0;
    __syncOnceInFlight = true;
    try {
        const items: unknown[] = [];
        const activeId = typeof location !== 'undefined' ? extractConversationIdFromUrl(location.pathname) : null;
        if (activeId) {
            const index = parseGeminiDomIndex(typeof document === 'undefined' ? null : document, activeId);
            if (index.title) items.push(index);
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
    if (all.hitGoogleLimit || all.completionReason === 'hit_google_limit') return 'partial_limit';
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
    let accountId: string | null = null;
    let coverageRun: ScanRun | null = null;
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

        const account = await resolveCurrentAccount();
        if (!account || account.slot !== slot) throw new Error('Sync requires a verified Registry account');
        accountId = account.accountId;
        coverageRun = await ScanLifecycle.beginScanCoverage(accountId, accountId);
        const runId = coverageRun.runId;
        const effectiveMaxPages = options?.maxPages || 2000;
        let expectedPage = 1;
        const previousRecent = coverageRun.previous;
        const incremental = !!previousRecent?.range;
        let recentHead: ScanHead | null = null;
        let verifiedIncrementalStop = false;
        // Scan All covers recent; other streams retain independent source boundaries.
        const all: GeminiProviderPageResult = await provider.listConversations({
            maxPages: effectiveMaxPages,
            accountId,
            canCommit: () => !contentContext.isAborted() && isCurrentAccount(account),
            includePinned: false,
            onPageBatch: async (info) => {
                const fresh = await resolveCurrentAccount();
                if (!fresh || fresh.accountId !== accountId || !isCurrentAccount(account)) {
                    throw new Error('Account changed during sync; retry in the current account');
                }
                if (contentContext.isAborted()) throw new Error('Sync aborted');
                if (info.page !== expectedPage++ || !await ScanLifecycle.isScanCoverageCurrent(accountId, runId)) {
                    throw new Error('Sync was superseded or pagination is not contiguous; retry');
                }
                const page = info.scanHead;
                if (page?.streamId === 'recent' && page.requestKnown && page.valid && page.ordered) {
                    if (page.requestCursor === null) recentHead = page;
                    if (incremental && previousRecent && recentHead && await CoverageAdmission.hasTrustedBoundary(accountId, previousRecent, recentHead)) {
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
            targetSid: slot,
            incremental
        });

        // Google-specific diagnostic/UI evidence stays at this Gemini consumer boundary.
        const diagnostics: GeminiPaginationDiagnostics = all?.diagnostics;
        const hitGoogleLimit = all.hitGoogleLimit || all.completionReason === 'hit_google_limit';
        if (all && diagnostics) {
            const setDiag = Storage?.setLastSyncDiagnostics || StorageService.setLastSyncDiagnostics;
            try { await setDiag(diagnostics); }
            catch (error) { console.warn('[Gemini Exporter] Could not save sync diagnostics:', error); }
        }

        const finalStatus = scanStatus(all, verifiedIncrementalStop);
        const finalAccount = await resolveCurrentAccount();
        if (finalAccount?.accountId !== accountId || !isCurrentAccount(account)) throw new Error('Account changed before sync completion');
        if (!await ScanLifecycle.finishScanCoverage(accountId, runId, finalStatus,
            () => !contentContext.isAborted() && getAccountSlot() === slot
                && isCurrentAccount(account))) {
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
                        accountId,
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
                ...(complete ? {} : { error: all.completionReason || status }) };
        }
        if (all) {
            const status = finalStatus;
            return { count: 0, diagnostics, hitGoogleLimit, status,
                ...(['complete', 'up_to_date'].includes(status) ? {} : { error: all.completionReason || status }) };
        }
    } catch (e: unknown) {
        if (accountId && coverageRun && !coverageFinished) {
            try { await ScanLifecycle.finishScanCoverage(accountId, coverageRun.runId, contentContext.isAborted() ? 'aborted' : 'error'); }
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
