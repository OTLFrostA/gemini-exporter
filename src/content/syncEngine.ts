import { scanAll } from '../core/application/sync/scanController.js';
import { persistConversationBatch, markConfirmedDeleted, upsertConversations, ingestRpcList, ingestPageObservation } from './geminiIndexCapture.js';
export { markConfirmedDeleted, upsertConversations, ingestRpcList, ingestPageObservation } from './geminiIndexCapture.js';
import { parseGeminiDomIndex } from '../core/parsers/gemini/dom/parseIndex.js';
import { type StoredValue } from '../core/storage/storageCompatibility.js';
import type { ApplicationProvider } from "./providerCompatibility.js";
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
import { resolveProvider } from '../core/provider/providerResolver.js';
import { detectSlotFromUrl, extractConversationIdFromUrl, normId, isReservedRoute } from '../core/utils/pathUtils.js';
import { resolveCurrentAccount, isCurrentAccount, getAccountContext } from './accountContext.js';

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

// Active scan orchestration belongs to Application; observers above remain Content concerns.
export { scanAll } from '../core/application/sync/scanController.js';

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
    scanAll,
    compareConversations
};


export default SyncEngine;
