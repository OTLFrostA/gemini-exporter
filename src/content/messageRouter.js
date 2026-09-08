// src/content/messageRouter.js - Content script runtime message dispatcher & RPC handlers
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MessageRouter = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function init({ syncEngine, scraper, assets, storage, utils } = {}) {
        const Sync = syncEngine || (typeof SyncEngine !== 'undefined' ? SyncEngine : null);
        const Scraper = scraper || (typeof DomScraper !== 'undefined' ? DomScraper : null);
        const Assets = assets || (typeof AssetFetcher !== 'undefined' ? AssetFetcher : null);
        const Storage = storage || (typeof StorageService !== 'undefined' ? StorageService : null);
        const Utils = utils || (typeof GeminiUtils !== 'undefined' ? GeminiUtils : {});

        const cleanTitle = (t) => (Utils.cleanTitle ? Utils.cleanTitle(t) : (t || '').trim());
        const isRealTitle = (t, id) => (Utils.isRealTitle ? Utils.isRealTitle(t, id) : !!(t && String(t).trim().length > 1));
        const setTitleBySource = (it, src, val) => (Utils.setTitleBySource ? Utils.setTitleBySource(it, src, val) : ((it.titles = it.titles || {})[src] = val));

        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) return;

        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.action === 'ping') {
                const ver = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '1.4.3';
                sendResponse({
                    ok: true,
                    version: ver,
                    ver: ver
                });
                return true;
            }

            if (msg.action === 'deepScan') {
                (async () => {
                    try {
                        let res = null;
                        if (Sync && Sync.tryBatchExecuteFull) {
                            res = await Sync.tryBatchExecuteFull({
                                forceIncremental: msg.mode === 'incremental',
                                forceFull: msg.mode === 'full'
                            });
                        }
                        sendResponse({
                            success: true,
                            count: res?.count || 0,
                            diagnostics: res?.diagnostics,
                            hitGoogleLimit: !!(res?.hitGoogleLimit || res?.diagnostics?.hitGoogleLimit)
                        });
                    } catch (e) {
                        const errStr = String(e?.message || e);
                        const isLimit = errStr.includes('BardErrorInfo')
                            || errStr.includes('1096')
                            || errStr.includes('429')
                            || /quota|rate\s*limit|resource_exhausted|too\s*many\s*requests/i.test(errStr);
                        sendResponse({ success: false, error: e.message, hitGoogleLimit: isLimit });
                    }
                })();
                return true;
            }

            if (msg.action === 'stopDeepScan' || msg.action === 'abortSync') {
                if (typeof window !== 'undefined') {
                    window.__gemExporterAborted = true;
                    try { window.__gemExporterActiveClient && window.__gemExporterActiveClient.abort(); } catch { /* intentional: best-effort cleanup */ }
                }
                sendResponse({ ok: true, aborted: true });
                return true;
            }

            if (msg.action === 'getScrollContainer') {
                const c = Scraper ? Scraper.getScrollContainer() : null;
                sendResponse({
                    found: !!c,
                    tag: c?.tagName || null,
                    id: c?.id || null,
                    class: c?.className?.slice(0, 120) || null
                });
                return true;
            }

            if (msg.action === 'getConversationDetail') {
                const cid = msg.conversationId || msg.id;
                if (!cid) {
                    sendResponse({ success: false, error: 'no id' });
                    return true;
                }
                (async () => {
                    async function persistDetailTitle(chatObj) {
                        if (!chatObj) return;
                        const normId = id => String(id || '').replace(/^c_/, '').trim();
                        const nid = normId(cid || chatObj.id);
                        chatObj.title = cleanTitle(chatObj.title);
                        let detectedSource = chatObj.titleSource || 'rpc';
                        if (!isRealTitle(chatObj.title, nid) && Array.isArray(chatObj.messages)) {
                            const firstUser = chatObj.messages.find(m => m.role === 'user' && m.content && m.content.trim());
                            if (firstUser) {
                                const candidate = cleanTitle(firstUser.content.trim().slice(0, 60).replace(/\n+/g, ' '));
                                if (isRealTitle(candidate, nid)) {
                                    chatObj.title = candidate;
                                    detectedSource = 'sniff';
                                }
                            }
                        }
                        if (!isRealTitle(chatObj.title, nid)) return;
                        const slot = msg.accountSlot || (Sync && Sync.getAccountSlot ? Sync.getAccountSlot() : 'u0');
                        try {
                            if (Storage) {
                                const list = await Storage.getConversations(slot);
                                const item = list.find(c => normId(c.id) === nid);
                                if (item) {
                                    setTitleBySource(item, detectedSource, chatObj.title);
                                    await Storage.setConversations(slot, list);
                                }
                            }
                        } catch (err) {
                            console.warn('[Gemini Exporter] persistDetailTitle error', err);
                        }
                    }

                    let batchexecuteEmptyDebug = null;
                    try {
                        let C = (typeof GeminiAPIClient !== 'undefined') ? GeminiAPIClient : window.GeminiAPIClient;
                        if (C) {
                            let client = new C();
                            let detail = await client.getConversationDetail(cid, msg.targetSid || null);
                            if (detail && Array.isArray(detail.messages) && detail.messages.length > 0) {
                                await persistDetailTitle(detail);
                                sendResponse({ success: true, data: detail, source: 'batchexecute' });
                                return;
                            } else if (detail) {
                                const rawKeys = detail._raw ? Object.keys(detail._raw) : [];
                                const rawPreview = detail._raw ? JSON.stringify(detail._raw).slice(0, 4000) : '';
                                const topPreview = detail._raw ? JSON.stringify(detail).slice(0, 1000) : '';
                                batchexecuteEmptyDebug = { rawKeys, rawPreview, topPreview, messagesLen: detail.messages?.length, hasRaw: !!detail._raw, titleSeen: detail.title };
                                if (typeof window !== 'undefined' && window.__gemExporterDevMode) {
                                    console.warn('[Gemini Exporter] batchexecute returned empty messages, fallback to DOM', cid, batchexecuteEmptyDebug);
                                }
                            }
                        }
                    } catch (e) {
                        batchexecuteEmptyDebug = { error: e.message };
                        if (typeof window !== 'undefined' && window.__gemExporterDevMode) {
                            console.warn('[Gemini Exporter] batchexecute detail fail, fallback to DOM', e.message);
                        }
                    }
                    try {
                        if (Scraper) {
                            let chat = await Scraper.contentFetchChatDetail(cid);
                            if (chat && Array.isArray(chat.messages) && chat.messages.length > 0) {
                                await persistDetailTitle(chat);
                                sendResponse({ success: true, data: chat, source: 'dom' });
                                return;
                            } else {
                                if (typeof window !== 'undefined' && window.__gemExporterDevMode) {
                                    console.warn('[Gemini Exporter] DOM fallback returned empty messages', cid, 'messages', chat?.messages?.length, 'has _raw', !!chat?._raw);
                                }
                                const isConfirmedDeleted = !!chat?.isDeleted || !!chat?._debug?.isNotFound;
                                if (isConfirmedDeleted) {
                                    const slot = msg.accountSlot || (Sync && Sync.getAccountSlot ? Sync.getAccountSlot() : 'u0');
                                    try {
                                        if (Storage && typeof Storage.removeConversation === 'function') {
                                            await Storage.removeConversation(slot, cid);
                                            const updatedList = await Storage.getConversations(slot);
                                            if (Sync && Sync.updateBadge) {
                                                Sync.updateBadge(updatedList.length, 0);
                                            }
                                            try {
                                                chrome.runtime.sendMessage({
                                                    action: 'syncUpdate',
                                                    slot,
                                                    count: updatedList.length,
                                                    from: 'prune-dead-chat'
                                                });
                                            } catch (e) {
                                                if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:messageRouter]', e);
                                            }
                                        }
                                    } catch (e) {
                                        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:messageRouter]', e);
                                    }
                                }
                                const mergedDebug = { batchexecuteEmptyDebug, domDebug: chat?._debug || null, domHtmlLen: chat?._debug?.htmlLen || null, isDeleted: isConfirmedDeleted };
                                sendResponse({ success: true, data: { ...chat, _empty: true, isDeleted: isConfirmedDeleted, error: isConfirmedDeleted ? '云端会话已被删除或不存在' : (chat?.error || 'DOM 返回内容为空'), _debug: mergedDebug, _debug_dom_empty: true }, source: 'dom' });
                                return;
                            }
                        }
                    } catch (e) {
                        const mergedDebug = { batchexecuteEmptyDebug, domError: e.message };
                        sendResponse({ success: false, error: e.message || String(e), _debug: mergedDebug });
                    }
                })();
                return true;
            }

            if (msg.action === 'getFileBlob') {
                if (Assets) Assets.handleGetFileBlob(msg, sendResponse);
                else sendResponse({ success: false, error: 'AssetFetcher not loaded' });
                return true;
            }

            if (msg.action === 'getImageBlob') {
                if (Assets) Assets.handleGetImageBlob(msg, sendResponse);
                else sendResponse({ success: false, error: 'AssetFetcher not loaded' });
                return true;
            }

            if (msg.action === 'downloadAssetDirect') {
                if (Assets) Assets.downloadAssetDirect(msg, sendResponse);
                else sendResponse({ success: false, error: 'AssetFetcher not loaded' });
                return true;
            }
        });
    }

    return {
        init
    };
}));
