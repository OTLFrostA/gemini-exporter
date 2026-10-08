import { isResourceConversationParseResult } from '../core/parsers/parsingResult.js';
import { extractBlockText } from '../core/domain/content/unknownFallback.js';
import { persistNativeConversation } from '../core/storage/domain/nativePersistence.js';
import { readStoredObject, type StoredObject } from '../core/storage/storageCompatibility.js';
import type { ContentConversationDetail, DomDetailDebug, GetConversationDetailResponse, ProviderEmptyDebug } from '../types/detailTransport.js';
import type { normalizeReliableTitleSource, TitleResolutionInput } from '../core/utils/titleUtils.js';
import type { ApplicationProvider } from "./providerCompatibility.js";
import { SyncEngine } from './syncEngine.js';
import { DomScraper } from './domScraper.js';
import { AssetFetcher } from './assetFetcher.js';
import { contentContext } from './contentContext.js';
import { StorageService } from '../core/storage/storageService.js';
import { GeminiUtils, getErrorMessage, resolveDetailTitle as defaultResolveDetailTitle } from '../core/utils/utils.js';
import { normId } from '../core/utils/pathUtils.js';
import { isRateLimited } from '../core/engine/export/rateLimiter.js';
import { isConfirmedDeletedError } from '../core/protocol/protocol.js';
import { getExtensionVersion } from '../core/utils/constants.js';
import { resolveProvider } from '../core/provider/providerResolver.js';
import { registerCleanup } from './cleanupRegistry.js';
import type { GetConversationDetailMessage } from '../types/messages.js';

// Only allow HTTPS URLs on Google media/content hosts before fetching assets.
function isAllowedAssetUrl(u: unknown): boolean {
    if (typeof u !== 'string' || !u) return false;
    let parsed: URL;
    try { parsed = new URL(u); } catch { return false; }
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return /(^|\.)(googleusercontent\.com|gstatic\.com|googleapis\.com|google\.com)$/.test(host);
}

export interface MessageRouterDeps {
    syncEngine?: typeof SyncEngine | null;
    scraper?: typeof DomScraper | null;
    assets?: typeof AssetFetcher | null;
    storage?: Partial<Pick<typeof StorageService, 'updateConversation' | 'removeConversation' | 'getLastSync' | 'getConversations'>> | null;
    utils?: (Partial<Pick<typeof GeminiUtils, 'cleanTitle' | 'isRealTitle' | 'setTitleBySource' | 'resolveDetailTitle'>> & { normalizeReliableTitleSource?: typeof normalizeReliableTitleSource }) | null;
}

export function init({
    syncEngine = SyncEngine,
    scraper = DomScraper,
    assets = AssetFetcher,
    storage = StorageService,
    utils = GeminiUtils
}: MessageRouterDeps = {}): void {
    const Sync = syncEngine;
    const Scraper = scraper;
    const Assets = assets;
    const Storage = storage;
    const Utils = utils;

    const cleanTitle = (t?: string | null) => (Utils?.cleanTitle ? Utils.cleanTitle(t || '') : (t || '').trim());
    const isRealTitle = (t?: string | null, id?: string) => (Utils?.isRealTitle ? Utils.isRealTitle(t || '', id) : !!(t && String(t).trim().length > 1));
    const setTitleBySource = (it: TitleResolutionInput, src: string, val: string) => {
        if (Utils?.setTitleBySource) return Utils.setTitleBySource(it, src, val);
        const rel = Utils?.normalizeReliableTitleSource ? Utils.normalizeReliableTitleSource(src) : undefined;
        if (rel && it) {
            (it.titles = it.titles || {})[rel] = val;
        }
    };
    const resolveDetailTitle = (msgs: Array<{ role: string; content: string }>, id?: string) => (Utils?.resolveDetailTitle ? Utils.resolveDetailTitle(msgs, id) : defaultResolveDetailTitle(msgs, id));

    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

    const dispatchMessage = (msg: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
        // Exactly-once responder to avoid leaving message port open on failure.
        let responded = false;
        const respond = (response: any) => {
            if (responded) return;
            responded = true;
            try { sendResponse(response); } catch { /* port may be gone */ }
        };
        try {
        if (msg.action === 'ping') {
            const ver = getExtensionVersion();
            respond({
                ok: true,
                version: ver,
                ver: ver
            });
            return;
        }

        if (msg.action === 'deepScan') {
            void (async () => {
                try {
                    let res: any = null;
                    if (Sync && Sync.tryBatchExecuteFull) {
                        res = await Sync.tryBatchExecuteFull({
                            forceFull: msg.mode === 'full'
                        });
                    }
                    if (!res) {
                        respond({
                            success: false,
                            count: 0,
                            error: 'deep scan did not produce a result (already running or provider unavailable)'
                        });
                        return;
                    }
                    respond({
                        success: true,
                        count: res?.count || 0,
                        diagnostics: res?.diagnostics,
                        hitGoogleLimit: !!(res?.hitGoogleLimit || res?.diagnostics?.hitGoogleLimit)
                    });
                } catch (e: unknown) {
                    const errStr = getErrorMessage(e);
                    const isLimit = isRateLimited({ success: false, error: errStr });
                    respond({ success: false, error: errStr, hitGoogleLimit: isLimit });
                }
            })();
            return true;
        }

        if (msg.action === 'stopDeepScan' || msg.action === 'abortSync') {
            contentContext.abort();
            if (typeof window !== 'undefined') {
                window.__gemExporterAborted = true;
                const active = window.__gemExporterActiveClient;
                if (typeof active?.abort === 'function') {
                    try { active.abort(); } catch { /* intentional: best-effort cleanup */ }
                }
            }
            respond({ ok: true, aborted: true });
            return true;
        }

        if (msg.action === 'getScrollContainer') {
            const c = Scraper ? Scraper.getScrollContainer() : null;
            respond({
                found: !!c,
                tag: c?.tagName || null,
                id: c?.id || null,
                class: c?.className?.slice(0, 120) || null
            });
            return true;
        }

        if (msg.action === 'getConversationDetail') {
            const detailMsg = msg as GetConversationDetailMessage;
            const respondDetail = (response: GetConversationDetailResponse) => respond(response);
            const cid = detailMsg.conversationId;
            if (!cid) {
                respondDetail({ success: false, error: 'no id' });
                return true;
            }
            void (async () => {
                async function persistDetailTitle(chatObj: ContentConversationDetail): Promise<void> {
                    if (!chatObj) return;
                    await persistNativeConversation(detailMsg.accountSlot || (Sync && Sync.getAccountSlot ? Sync.getAccountSlot() : 'u0'), chatObj);
                    const chat = { ...chatObj.conversation, titles: { ...chatObj.conversation.titles } };
                    const nid = normId(cid || chat.id);
                    chat.title = cleanTitle(chat.title);
                    let detectedSource = chat.titleSource || 'rpc';
                    if (!isRealTitle(chat.title, nid) && Array.isArray(chat.messages)) {
                        const sniffed = resolveDetailTitle(chat.messages.map(message => ({ role: message.role, content: message.content.map(block => extractBlockText(block)).join('\n\n') })), nid);
                        if (sniffed) {
                            chat.title = sniffed.title;
                            detectedSource = sniffed.source;
                        }
                    }
                    if (!isRealTitle(chat.title, nid)) return;
                    const slot = detailMsg.accountSlot || (Sync && Sync.getAccountSlot ? Sync.getAccountSlot() : 'u0');
                    try {
                        // SSOT: single-item title update runs inside the cross-tab
                        // conversation lock via updateConversation. The old shape
                        // (read list outside the lock, mutate, blind setConversations)
                        // could clobber a concurrent tab's sync (lost update), and
                        // bypassed nothing here since setTitleBySource already
                        // arbitrates through the title tiers.
                        if (Storage && typeof Storage.updateConversation === 'function') {
                            await Storage.updateConversation(slot, nid, (current) => {
                                if (!current) return null;
                                const item: StoredObject = { ...current, titles: { ...readStoredObject(current.titles || {}) } };
                                const beforeTitle = item.title;
                                const beforeSource = item.titleSource;
                                const titleTarget: Record<string, unknown> = item;
                                setTitleBySource(titleTarget, detectedSource, chat.title);
                                if (item.title === beforeTitle && item.titleSource === beforeSource) return null;
                                return { title: item.title, titleSource: item.titleSource, titles: item.titles };
                            });
                        }
                    } catch (err) {
                        console.warn('[Gemini Exporter] persistDetailTitle error', err);
                    }
                }

                let batchexecuteEmptyDebug: ProviderEmptyDebug | null = null;
                try {
                    const provider = resolveProvider() as ApplicationProvider | undefined;
                    if (provider) {
                        const detail = await provider.fetchConversationDetail(cid, { targetSid: detailMsg.targetSid || null });
                        if (detail && isResourceConversationParseResult(detail) && detail.conversation.messages.length > 0) {
                            await persistDetailTitle(detail);
                            respondDetail({ success: true, data: detail, source: 'batchexecute' });
                            return;
                        } else if (detail) {
                            const rawKeys = detail.transport.decodedPayload ? Object.keys(detail.transport.decodedPayload) : [];
                            const rawPreview = detail.transport.decodedPayload ? JSON.stringify(detail.transport.decodedPayload).slice(0, 4000) : '';
                            const topPreview = detail.transport.decodedPayload ? JSON.stringify(detail).slice(0, 1000) : '';
                            batchexecuteEmptyDebug = { rawKeys, rawPreview, topPreview, messagesLen: detail.conversation.messages.length, hasRaw: !!detail.transport.decodedPayload, titleSeen: detail.conversation.title };
                            if (contentContext.isDevMode()) {
                                console.warn('[Gemini Exporter] batchexecute returned empty messages, fallback to DOM', cid, batchexecuteEmptyDebug);
                            }
                        }
                    }
                } catch (e: unknown) {
                    const errMsg = getErrorMessage(e);
                    batchexecuteEmptyDebug = { error: errMsg };
                    if (contentContext.isDevMode()) {
                        console.warn('[Gemini Exporter] batchexecute detail fail, fallback to DOM', errMsg);
                    }
                    const isRpcDeleted = isConfirmedDeletedError(errMsg);
                    if (isRpcDeleted) {
                        const slot = detailMsg.accountSlot || (Sync && Sync.getAccountSlot ? Sync.getAccountSlot() : 'u0');
                        try {
                            if (Storage && typeof Storage.removeConversation === 'function') {
                                Sync?.markConfirmedDeleted?.(slot, cid);
                                await Storage.removeConversation(slot, cid);
                                const syncMeta = (Storage.getLastSync && typeof Storage.getLastSync === 'function')
                                    ? await Storage.getLastSync(slot)
                                    : { count: (await Storage.getConversations!(slot)).length };
                                const count = syncMeta.count;
                                if (Sync && Sync.updateBadge) {
                                    Sync.updateBadge(count, 0);
                                }
                                try {
                                    void chrome.runtime.sendMessage({
                                        action: 'syncUpdate',
                                        slot,
                                        count,
                                        from: 'prune-dead-chat'
                                    });
                                } catch (e) {
                                    if (contentContext.isDevMode()) console.debug('[GemExporter:messageRouter]', e);
                                }
                            }
                        } catch (e) {
                            if (contentContext.isDevMode()) console.debug('[GemExporter:messageRouter]', e);
                        }
                        const errDeleted = contentContext.isZh() ? '云端会话已被删除或不存在' : 'Cloud conversation deleted or does not exist';
                        respondDetail({
                            success: true,
                            data: {
                                id: cid,
                                title: cid,
                                _empty: true,
                                isDeleted: true,
                                error: errDeleted,
                                _debug: { batchexecuteEmptyDebug: { error: errMsg, isDeleted: true }, isDeleted: true }
                            },
                            source: 'batchexecute'
                        });
                        return;
                    }
                }
                try {
                    if (Scraper) {
                        const chat = await Scraper.contentFetchChatDetail(cid);
                        if (chat && isResourceConversationParseResult(chat) && chat.conversation.messages.length > 0) {
                            await persistDetailTitle(chat);
                            respondDetail({ success: true, data: chat, source: 'dom' });
                            return;
                        } else {
                            const failure = chat && 'error' in chat ? chat : { id: cid, error: 'DOM returned empty content' };
                            const isConfirmedDeleted = !!failure?.isDeleted
                                || !!failure?._debug && 'isNotFound' in failure._debug && failure._debug.isNotFound === true
                                || (typeof failure?.error === 'string' && (failure.error.includes('删除或不存在') || failure.error.includes('服务端删除')));
                            if (isConfirmedDeleted) {
                                const slot = detailMsg.accountSlot || (Sync && Sync.getAccountSlot ? Sync.getAccountSlot() : 'u0');
                                try {
                                    if (Storage && typeof Storage.removeConversation === 'function') {
                                        Sync?.markConfirmedDeleted?.(slot, cid);
                                await Storage.removeConversation(slot, cid);
                                        const syncMeta = (Storage.getLastSync && typeof Storage.getLastSync === 'function')
                                            ? await Storage.getLastSync(slot)
                                            : { count: (await Storage.getConversations!(slot)).length };
                                        const count = syncMeta.count;
                                        if (Sync && Sync.updateBadge) {
                                            Sync.updateBadge(count, 0);
                                        }
                                        try {
                                            void chrome.runtime.sendMessage({
                                                action: 'syncUpdate',
                                                slot,
                                                count,
                                                from: 'prune-dead-chat'
                                            });
                                        } catch (e) {
                                            if (contentContext.isDevMode()) console.debug('[GemExporter:messageRouter]', e);
                                        }
                                    }
                                } catch (e) {
                                    if (contentContext.isDevMode()) console.debug('[GemExporter:messageRouter]', e);
                                }
                            }
                            const domDebug = chat && isResourceConversationParseResult(chat) && 'transport' in chat ? chat.transport as DomDetailDebug : failure._debug && 'batchexecuteEmptyDebug' in failure._debug ? failure._debug.domDebug ?? undefined : failure._debug;
                            const mergedDebug = { batchexecuteEmptyDebug, domDebug, domHtmlLen: domDebug && 'htmlLen' in domDebug ? domDebug.htmlLen : null, isDeleted: isConfirmedDeleted };
                            const errDeleted = contentContext.isZh() ? '云端会话已被删除或不存在' : 'Cloud conversation deleted or does not exist';
                            const errDomEmpty = contentContext.isZh() ? 'DOM 返回内容为空' : 'DOM returned empty content';
                            respondDetail({
                                success: true,
                                data: {
                                    id: failure?.id || cid,
                                    title: failure?.title || cid,
                                    _empty: true,
                                    isEmpty: !isConfirmedDeleted,
                                    isDeleted: isConfirmedDeleted,
                                    error: isConfirmedDeleted ? errDeleted : (failure?.error || errDomEmpty),
                                    _debug: mergedDebug,
                                    _debug_dom_empty: true
                                },
                                source: 'dom'
                            });
                            return;
                        }
                    }
                } catch (e: unknown) {
                    const errMsg = getErrorMessage(e);
                    const mergedDebug = { batchexecuteEmptyDebug, domError: errMsg };
                    respondDetail({ success: false, error: errMsg, _debug: mergedDebug });
                }
                // S1: fail closed — every response path above returns, so
                // reaching here means nothing was sent (e.g. no provider
                // and no scraper). Never leave the port hanging. The
                // exactly-once guard makes this a no-op when a response
                // was already produced.
                respondDetail({ ok: false, success: false, error: 'conversation detail unavailable: no provider or scraper produced a result' });
            })();
            return true;
        }

        if (msg.action === 'getFileBlob') {
            if (!isAllowedAssetUrl(msg.url)) { respond({ success: false, error: 'blocked: asset url not allowlisted (' + String(msg.url).split('?')[0].slice(0, 160) + ')'  }); return true; }
            if (Assets) void Assets.handleGetFileBlob(msg, respond);
            else respond({ success: false, error: 'AssetFetcher not loaded' });
            return true;
        }

        if (msg.action === 'getImageBlob') {
            if (!isAllowedAssetUrl(msg.url)) { respond({ success: false, error: 'blocked: asset url not allowlisted (' + String(msg.url).split('?')[0].slice(0, 160) + ')'  }); return true; }
            if (Assets) void Assets.handleGetImageBlob(msg, respond);
            else respond({ success: false, error: 'AssetFetcher not loaded' });
            return true;
        }

        if (msg.action === 'downloadAssetDirect') {
            if (!isAllowedAssetUrl(msg.url)) { respond({ success: false, error: 'blocked: asset url not allowlisted (' + String(msg.url).split('?')[0].slice(0, 160) + ')'  }); return true; }
            if (Assets) void Assets.downloadAssetDirect(msg, respond);
            else respond({ success: false, error: 'AssetFetcher not loaded' });
            return true;
        }

        // Unknown action: structured error instead of port closed
        respond({ ok: false, success: false, error: `unknown action: ${msg.action}` });
        } catch (e: unknown) {
            respond({ ok: false, success: false, error: getErrorMessage(e) });
        }
    };
    chrome.runtime.onMessage.addListener(dispatchMessage);
    registerCleanup(() => {
        try { chrome.runtime.onMessage.removeListener(dispatchMessage); } catch { /* already gone */ }
    });
}

export const MessageRouter = {
    init
};

export default MessageRouter;
