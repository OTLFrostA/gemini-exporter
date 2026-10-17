import { ingestRpcList, ingestPageObservation } from './geminiIndexCapture.js';
import { getAccount } from '../core/api/accountRegistry.js';
import type { GeminiIndexObservationInput } from '../core/parsers/gemini/parseIndexObservation.js';
import { geminiListObservation } from '../core/provider/gemini/listObservation.js';
import { resolveRequestAccount, resolveCurrentAccount } from './accountContext.js';
import type { PageObservation } from '../core/domain/pageObservation.js';
import { ingestConversation } from '../core/domain/ingestion.js';
import { parseGeminiRpcConversation } from '../core/parsers/gemini/rpc/parseConversation.js';
import type { GeminiProviderConversationItem } from '../core/provider/gemini/geminiContracts.js';
import type { RpcListIngestResult } from './geminiIndexCapture.js';
import { contentContext } from './contentContext.js';
import { parseList } from '../core/parsers/gemini/rpc/parseList.js';
import { GeminiProtocol, CrossWorldEvents } from '../core/protocol/protocol.js';
import { LiveSaveObserver } from './liveSaveObserver.js';
import { extractConversationIdFromUrl, normId } from '../core/utils/pathUtils.js';
import { normalizeReliableTitleSource } from '../core/domain/titleAuthority.js';
import type { TitleSource } from '../types/index.js';
import { registerCleanup } from './cleanupRegistry.js';


export type MessageBridgeConversationInput = GeminiIndexObservationInput;

export interface MessageBridgeDeps {
    ingestPageObservation?: (page: PageObservation<GeminiProviderConversationItem>, slot: string) => Promise<RpcListIngestResult>;
    ingestRpcList?: (items: GeminiProviderConversationItem[], slot: string, requestedAt?: number, canCommit?: () => boolean) => Promise<RpcListIngestResult>;
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
        const text = field('text'), truncated = field('truncated'), requestedAt = field('requestedAt');
        if (typeof text !== 'string' || !text || (truncated !== undefined && typeof truncated !== 'boolean')
            || (requestedAt !== undefined && (typeof requestedAt !== 'number' || !Number.isFinite(requestedAt)))) return;
        const request = field('listRequest');
        let listRequest: import('../core/parsers/gemini/rpc/listRequest.js').GeminiListRequestContext | null = null;
        if (request !== undefined && request !== null) {
            if (typeof request !== 'object' || !('streamId' in request) || !('requestCursor' in request)
                || (request.streamId !== 'recent' && request.streamId !== 'pinned')
                || (request.requestCursor !== null && typeof request.requestCursor !== 'string')) return;
            listRequest = { streamId: request.streamId, requestCursor: request.requestCursor };
        }
        try {
            const Proto = (_deps && _deps.protocol) || GeminiProtocol;
            if (!Proto) return;
            const targetSlot = slot;
            if (!targetSlot) return;
            const account = await resolveRequestAccount(field('requestAccountObservation'), targetSlot);
            if (!account) return;
            const canCommit = () => true;

            if (text.includes(Proto.RPCS.LIST)) {
                try {
                    const listRes = parseList(text);
                    if (listRes && listRes.conversations) {
                        if (!canCommit()) return;
                        if (_deps.ingestPageObservation) {
                            await _deps.ingestPageObservation(geminiListObservation(listRes, listRequest ?? null,
                                account.accountId, truncated, requestedAt), account.accountId);
                        } else if (_deps.ingestRpcList) {
                            await _deps.ingestRpcList(listRes.conversations, account.accountId, requestedAt, canCommit);
                        } else {
                            await ingestPageObservation(geminiListObservation(listRes, listRequest ?? null,
                                account.accountId, truncated, requestedAt), account.accountId);
                        }
                    }
                } catch (e) {
                    if (contentContext.isDevMode()) console.debug('[MessageBridge] parseList err', e);
                }
            }

            if (text.includes(Proto.RPCS.DETAIL)) {
                try {
                    const registered = await getAccount(account.accountId);
                    if (!registered) throw new Error('Account no longer exists');
                    const native = parseGeminiRpcConversation(text, { providerId: 'gemini', account: registered });
                    const detailRes = native.conversation;
                    if (detailRes && detailRes.index.key.conversationId) {
                        if (!canCommit()) return;
                        await ingestConversation(account.accountId, native, [], canCommit);
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
                // Verify against the request's captured UUID even if this tab has switched.
                // The background still requires authoritative detail confirmation.
                const account = await resolveRequestAccount(field('requestAccountObservation'), slot || 'u0');
                if (!account) return;
                const targetAccountId = account.accountId;
                // Page-world postMessage is untrusted. The detail route only
                // marks cloud unavailability after authoritative confirmation; local archives remain.
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    for (const delayMs of [0, 500, 1500]) {
                        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
                        try {
                            const result = await chrome.runtime.sendMessage({ action: 'fetchChat', conversationId: cleanId, accountId: targetAccountId });
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

    let streamAccountId: string | undefined;
    if (raw.type === CrossWorldEvents.STREAM_START || raw.type === CrossWorldEvents.STREAM_COMPLETE) {
        const captured = await resolveRequestAccount(field('requestAccountObservation'), slot || (getAccountSlot ? getAccountSlot() : 'u0'));
        const current = await resolveCurrentAccount();
        if (!captured || !current || captured.accountId !== current.accountId || captured.slot !== current.slot) return;
        streamAccountId = captured.accountId;
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
                    }], 'stream-start', true, streamAccountId);
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
                    const item: GeminiIndexObservationInput = {
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
                    await upsertConversations([item], 'stream-complete', true, streamAccountId);
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
