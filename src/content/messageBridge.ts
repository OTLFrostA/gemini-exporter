import type { IndexObservationInput } from '../core/compatibility/index/parseIndex.js';
import { geminiListObservation } from '../core/provider/gemini/listObservation.js';
import { sniffUserProfileFromDom } from './accountSniffer.js';
import type { PageObservation } from '../core/sync/pageObservation.js';
import { extractBlockText } from '../core/domain/content/unknownFallback.js';
import { persistNativeConversation } from '../core/storage/domain/nativePersistence.js';
import { parseGeminiRpcConversation } from '../core/parsers/gemini/rpc/parseConversation.js';
import type { GeminiProviderConversationItem } from '../core/provider/gemini/geminiContracts.js';
import type { RpcListIngestResult } from './syncEngine.js';
import { contentContext } from './contentContext.js';
import { parseList } from '../core/parsers/gemini/rpc/parseList.js';
import { GeminiProtocol, CrossWorldEvents } from '../core/protocol/protocol.js';
import { LiveSaveObserver } from './liveSaveObserver.js';
import { extractConversationIdFromUrl, normId } from '../core/utils/pathUtils.js';
import { TITLE_TIER_RANK, resolveDetailTitle, normalizeReliableTitleSource } from '../core/utils/titleUtils.js';
import type { TitleSource } from '../types/index.js';
import { registerCleanup } from './cleanupRegistry.js';


export type MessageBridgeConversationInput = IndexObservationInput;

export interface MessageBridgeDeps {
    ingestPageObservation?: (page: PageObservation<GeminiProviderConversationItem>, slot: string) => Promise<RpcListIngestResult>;
    ingestRpcList?: (items: GeminiProviderConversationItem[], slot: string) => Promise<RpcListIngestResult>;
    upsertConversations?: (items: MessageBridgeConversationInput[], source: string, forceWrite?: boolean, targetSlot?: string) => Promise<number>;
    touchActiveConversation?: (cid: string, slot?: string, options?: { forceWrite?: boolean; source?: string }) => Promise<number>;
    extractActiveChatTitle?: (id: string) => { title: string; source: string } | null;
    getAccountSlot?: () => string;
    isRealTitle?: (t: string, id: string) => boolean;
    cleanTitle?: (t: string) => string;
    updateBadge?: (mergedLen: number, visible?: number) => void;
    ensureBadge?: () => HTMLElement | null;
    Storage?: any;
    protocol?: any;
    onStreamStart?: (cid?: string | null, slot?: string) => void;
    onStreamComplete?: (cid?: string | null, slot?: string) => void;
}

let _deps: MessageBridgeDeps | null = null;

export function init(dependencies: MessageBridgeDeps = {}): { handleWindowMessage: (event: MessageEvent) => Promise<void> } {
    _deps = dependencies;
    if (typeof window !== 'undefined' && window.addEventListener) {
        const w = window as any;
        // Guard on window to survive re-injection and register removal on cleanup
        if (!w.__gemExporterBridgeListening) {
            window.addEventListener('message', handleWindowMessage);
            w.__gemExporterBridgeListening = true;
        }
        registerCleanup(() => {
            try { window.removeEventListener('message', handleWindowMessage); } catch { /* already gone */ }
            w.__gemExporterBridgeListening = false;
        });
    }
    return { handleWindowMessage };
}

export async function handleWindowMessage(event: MessageEvent): Promise<void> {
    if (!event || !_deps) return;
    if (typeof location !== 'undefined' && event.origin !== location.origin) return;
    // Restrict to same-window messages (does NOT authenticate the sender against page scripts).
    if (event.source && (typeof window === 'undefined' || event.source !== window)) return;
    const raw: unknown = event.data;
    if (!raw || typeof raw !== 'object' || !('type' in raw) || !('payload' in raw)) return;
    const payload: unknown = raw.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const field = (key: string): unknown => Reflect.get(payload, key);
    const slot = field('slot');
    if (slot !== undefined && typeof slot !== 'string') return;
    const id = field('id');
    if (id !== undefined && id !== null && typeof id !== 'string') return;

    const {
        upsertConversations,
        getAccountSlot,
        isRealTitle = () => true,
        cleanTitle = (t: string) => (t || '').trim()
    } = _deps;

    if (raw.type === CrossWorldEvents.NETWORK_BATCHEXECUTE) {
        const text = field('text'), truncated = field('truncated'), requestedAt = field('requestedAt'), requestAccountId = field('requestAccountId');
        if (typeof text !== 'string' || !text || (truncated !== undefined && typeof truncated !== 'boolean')
            || (requestedAt !== undefined && (typeof requestedAt !== 'number' || !Number.isFinite(requestedAt)))
            || (requestAccountId !== undefined && requestAccountId !== null && typeof requestAccountId !== 'string')) return;
        const request = field('listRequest');
        let listRequest: import('../core/provider/gemini/listObservation.js').GeminiListRequestContext | null = null;
        if (request !== undefined && request !== null) {
            if (typeof request !== 'object' || !('streamId' in request) || !('requestCursor' in request)
                || (request.streamId !== 'recent' && request.streamId !== 'pinned')
                || (request.requestCursor !== null && typeof request.requestCursor !== 'string')) return;
            listRequest = { streamId: request.streamId, requestCursor: request.requestCursor };
        }
        try {
            const Proto = (_deps && _deps.protocol) || GeminiProtocol;
            if (!Proto) return;

            if (text.includes(Proto.RPCS.LIST)) {
                try {
                    const listRes = parseList(text);
                    if (listRes && listRes.conversations) {
                        const targetSlot = slot === 'default' ? 'u0' : slot || (getAccountSlot ? getAccountSlot() : 'u0');
                        const currentAccountId = sniffUserProfileFromDom()?.accountId ?? null;
                        if (getAccountSlot && targetSlot !== getAccountSlot()) return;
                        if (requestAccountId != null && requestAccountId !== currentAccountId) return;
                        if (_deps.ingestPageObservation) {
                            await _deps.ingestPageObservation(geminiListObservation(listRes, listRequest ?? null,
                                requestAccountId ?? null, truncated, requestedAt), targetSlot);
                        } else if (_deps.ingestRpcList) {
                            await _deps.ingestRpcList(listRes.conversations, targetSlot);
                        }
                    }
                } catch (e) {
                    if (contentContext.isDevMode()) console.debug('[MessageBridge] parseList err', e);
                }
            }

            if (text.includes(Proto.RPCS.DETAIL) && typeof upsertConversations === 'function') {
                try {
                    const native = parseGeminiRpcConversation(text, { providerId: 'gemini' });
                    const detailRes = native.conversation;
                    if (detailRes && detailRes.id) {
                        const nid = normId(detailRes.id);
                        let title = cleanTitle(detailRes.title);
                        let sourceTier = detailRes.titleSource || 'legacy';
                        if (!isRealTitle(title, nid) && Array.isArray(detailRes.messages)) {
                            const sniffed = resolveDetailTitle(detailRes.messages.map(message => ({ role: message.role, content: message.content.map(block => extractBlockText(block)).join('\n\n') })), nid);
                            if (sniffed) {
                                title = sniffed.title;
                                sourceTier = sniffed.source;
                            }
                        }
                        const targetSlot = slot || (getAccountSlot ? getAccountSlot() : 'u0');
                        await persistNativeConversation(targetSlot, native);

                        if (isRealTitle(title, nid)) {
                            await upsertConversations([{
                                id: nid,
                                title: title,
                                titleSource: sourceTier,
                                url: `https://gemini.google.com/app/${nid}`,
                                updatedAt: detailRes.updatedAt,
                                sidebarIndex: 0
                            }], 'network-detail', false, targetSlot);
                        }
                    }
                } catch (e) {
                    if (contentContext.isDevMode()) console.debug('[MessageBridge] parseDetail err', e);
                }
            }
        } catch (err) {
            if (contentContext.isDevMode()) console.debug('[MessageBridge] batchexecute hook process error', err);
        }
        return;
    }

    if (raw.type === CrossWorldEvents.CONVERSATION_DELETED) {
        const isValidConvId = typeof id === 'string' && id.trim().length > 0 && id.trim().length <= 128 && /^[a-zA-Z0-9_\-]+$/.test(id.trim());
        if (id && isValidConvId) {
            const cleanId = id.trim();
            try {
                // Route verification through the account of this content tab,
                // never through a slot supplied by page-world JavaScript.
                const targetSlot = (getAccountSlot ? getAccountSlot() : 'u0') || 'u0';
                // Page-world postMessage is untrusted. The detail route only
                // marks cloud unavailability after authoritative confirmation; local archives remain.
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    for (const delayMs of [0, 500, 1500]) {
                        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
                        try {
                            const result = await chrome.runtime.sendMessage({ action: 'fetchChat', conversationId: cleanId, accountSlot: targetSlot });
                            if (result?.data?.isDeleted === true) break;
                        } catch (err) {
                            if (contentContext.isDevMode()) console.debug('[MessageBridge] delete verification attempt failed', err);
                        }
                    }
                }
            } catch (err) {
                if (contentContext.isDevMode()) console.debug('[MessageBridge] verify deleted conversation err', err);
            }
        }
        return;
    }

    if (raw.type === CrossWorldEvents.STREAM_START) {
        if (typeof _deps?.onStreamStart === 'function') {
            _deps.onStreamStart(id, slot);
        } else {
            const obs = LiveSaveObserver;
            if (obs && typeof obs.notifyStreamStart === 'function') {
                obs.notifyStreamStart(id);
            }
        }
        const activeId = id ? normId(id) : (typeof location !== 'undefined' ? extractConversationIdFromUrl(location.pathname) : null);
        if (activeId) {
            const nid = activeId;
            const targetSlot = slot || (getAccountSlot ? getAccountSlot() : 'u0') || 'u0';
            try {
                if (typeof _deps?.touchActiveConversation === 'function') {
                    await _deps.touchActiveConversation(nid, targetSlot, { source: 'stream-start' });
                } else if (typeof upsertConversations === 'function') {
                    // SSOT timestamp authority: no client-clock timestamp here;
                    // timestamp/updatedAt are server-authoritative (see
                    // touchActiveConversation in syncEngine.ts).
                    await upsertConversations([{
                        id: nid,
                        url: `https://gemini.google.com/app/${nid}`,
                        sidebarIndex: 0
                    }], 'stream-start', true, targetSlot);
                }
            } catch (err) {
                if (contentContext.isDevMode()) console.debug('[MessageBridge] stream start touch err', err);
            }
        }
        return;
    }

    if (raw.type === CrossWorldEvents.STREAM_COMPLETE) {
        if (typeof _deps?.onStreamComplete === 'function') {
            _deps.onStreamComplete(id, slot);
        } else {
            const obs = LiveSaveObserver;
            if (obs && typeof obs.notifyStreamComplete === 'function') {
                obs.notifyStreamComplete(id);
            }
        }
        const activeId = id ? normId(id) : (typeof location !== 'undefined' ? extractConversationIdFromUrl(location.pathname) : null);
        if (activeId) {
            const nid = activeId;
            const targetSlot = slot || (getAccountSlot ? getAccountSlot() : 'u0') || 'u0';
            try {
                if (typeof _deps?.touchActiveConversation === 'function') {
                    await _deps.touchActiveConversation(nid, targetSlot, { source: 'stream-complete' });
                } else if (typeof upsertConversations === 'function') {
                    // SSOT timestamp authority: no client-clock timestamp here;
                    // timestamp/updatedAt are server-authoritative (see
                    // touchActiveConversation in syncEngine.ts).
                    const item: IndexObservationInput = {
                        id: nid,
                        url: `https://gemini.google.com/app/${nid}`,
                        sidebarIndex: 0
                    };
                    if (typeof _deps?.extractActiveChatTitle === 'function') {
                        const titleObj = _deps.extractActiveChatTitle(nid);
                        if (titleObj && titleObj.title && isRealTitle(titleObj.title, nid)) {
                            item.title = cleanTitle(titleObj.title);
                            const sourceTier = normalizeReliableTitleSource(titleObj.source) || 'dom';
                            item.titleSource = sourceTier;
                        }
                    }
                    await upsertConversations([item], 'stream-complete', true, targetSlot);
                }
            } catch (err) {
                if (contentContext.isDevMode()) console.debug('[MessageBridge] stream complete touch err', err);
            }
        }
        return;
    }
}

export const MessageBridge = {
    init,
    handleWindowMessage
};

export default MessageBridge;
