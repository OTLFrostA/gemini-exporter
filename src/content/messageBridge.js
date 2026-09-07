// src/content/messageBridge.js - Inter-world message bridge between MAIN world hooks and content script
(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MessageBridge = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    let _deps = null;
    let _listening = false;

    function init(dependencies = {}) {
        _deps = dependencies;
        if (!_listening && typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('message', handleWindowMessage);
            _listening = true;
        }
        return { handleWindowMessage };
    }

    async function handleWindowMessage(event) {
        if (!event || !_deps) return;
        if (typeof location !== 'undefined' && event.origin !== location.origin) return;
        const d = event.data;
        if (!d || typeof d !== 'object') return;

        const {
            upsertConversations,
            getAccountSlot,
            isRealTitle = () => true,
            cleanTitle = (t) => (t || '').trim(),
            updateBadge,
            ensureBadge,
            Storage
        } = _deps;

        // 1. Captured batchexecute response (Sidebar scroll, search, page load, opening any chat)
        if (d.type === 'GEMINI_NETWORK_BATCHEXECUTE') {
            const { text, slot } = d.payload || {};
            if (!text) return;
            try {
                let parser = (typeof GeminiResponseParserClass !== 'undefined')
                    ? GeminiResponseParserClass
                    : (typeof globalThis !== 'undefined' ? globalThis.GeminiResponseParserClass : null);
                if (!parser) return;

                // If response contains conversation list (sidebar scroll or search)
                if (text.includes('MaZiqc') && typeof upsertConversations === 'function') {
                    try {
                        const listRes = parser.parseList(text);
                        if (listRes && listRes.conversations && listRes.conversations.length) {
                            const targetSlot = slot || (getAccountSlot ? getAccountSlot() : 'u0');
                            await upsertConversations(listRes.conversations, 'network-list', false, targetSlot);
                        }
                    } catch (e) {
                        console.debug('[MessageBridge] parseList err', e);
                    }
                }

                // If response contains conversation detail (opening any chat)
                if (text.includes('hNvQHb') && typeof upsertConversations === 'function') {
                    try {
                        const detailRes = parser.parseDetail(text);
                        if (detailRes && detailRes.id) {
                            const nid = String(detailRes.id).replace(/^c_/, '').trim();
                            let title = cleanTitle(detailRes.title);
                            let sourceTier = detailRes.titleSource || 'rpc';
                            if (!isRealTitle(title, nid) && Array.isArray(detailRes.messages)) {
                                const firstUser = detailRes.messages.find(m => m.role === 'user' && m.content && m.content.trim());
                                if (firstUser) {
                                    const candidate = cleanTitle(firstUser.content.trim().slice(0, 60).replace(/\n+/g, ' '));
                                    if (isRealTitle(candidate, nid)) {
                                        title = candidate;
                                        sourceTier = 'sniff';
                                    }
                                }
                            }
                            if (isRealTitle(title, nid)) {
                                const titlesObj = detailRes.titles || {};
                                titlesObj[sourceTier] = title;
                                const targetSlot = slot || (getAccountSlot ? getAccountSlot() : 'u0');
                                await upsertConversations([{
                                    id: nid,
                                    title: title,
                                    titleSource: sourceTier,
                                    titles: titlesObj,
                                    url: `https://gemini.google.com/app/${nid}`,
                                    href: `https://gemini.google.com/app/${nid}`,
                                    timestamp: detailRes.updatedAt || detailRes.timestamp,
                                    updatedAt: detailRes.updatedAt || detailRes.timestamp,
                                    createdAt: detailRes.createdAt,
                                    sidebarIndex: 0
                                }], 'network-detail', false, targetSlot);
                            }
                        }
                    } catch (e) {
                        console.debug('[MessageBridge] parseDetail err', e);
                    }
                }
            } catch (err) {
                console.debug('[MessageBridge] batchexecute hook process error', err);
            }
            return;
        }

        // 2. Real-time conversation deletion hook listener (GzXR5e)
        if (d.type === 'GEMINI_CONVERSATION_DELETED') {
            const { id, slot } = d.payload || {};
            if (id) {
                try {
                    const targetSlot = slot || (getAccountSlot ? getAccountSlot() : 'u0') || 'u0';
                    if (Storage && typeof Storage.removeConversation === 'function') {
                        const removed = await Storage.removeConversation(targetSlot, id);
                        if (removed) {
                            const updatedList = await Storage.getConversations(targetSlot);
                            if (updateBadge) updateBadge(updatedList.length, 0);
                            try {
                                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                                    chrome.runtime.sendMessage({
                                        action: 'syncUpdate',
                                        slot: targetSlot,
                                        count: updatedList.length,
                                        from: 'delete-event'
                                    });
                                }
                            } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[MessageBridge]", e); }
                            console.log(`[MessageBridge] Realtime pruned deleted conversation ${id} from slot ${targetSlot}`);
                        }
                    }
                } catch (err) {
                    console.debug('[MessageBridge] remove deleted conversation err', err);
                }
            }
            return;
        }

        // 3. Fallback network ids hook listener
        if (d.type === '__gemExporterNetworkIds') {
            const ids = d.ids || [];
            if (!ids.length || typeof upsertConversations !== 'function') return;
            try {
                let mockItems = ids.map(id => ({
                    id,
                    title: '未命名对话(' + id.slice(0, 6) + ')',
                    href: `https://gemini.google.com/app/${id}`,
                    url: `https://gemini.google.com/app/${id}`
                }));
                let mergedLen = await upsertConversations(mockItems, 'network:' + (d.source || ''));
                const globalScope = (typeof window !== 'undefined') ? window : globalThis;
                if (!globalScope.__gemExporterDeepScanPromise) {
                    const badgeTxt = (typeof document !== 'undefined') ? document.getElementById('geminiExportBadgeText') : null;
                    if (badgeTxt) badgeTxt.textContent = `已同步 ${mergedLen} 条`;
                    else if (ensureBadge) ensureBadge();
                }
            } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[MessageBridge]", e); }
        }
    }

    return {
        init,
        handleWindowMessage
    };
}));
