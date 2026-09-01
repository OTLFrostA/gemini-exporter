// content.js - Gemini Exporter content script coordinator
(() => {
    if (typeof window.__gemExporterDeepScanPromise === 'undefined') window.__gemExporterDeepScanPromise = null;

    if (window.__gemExporterInjected) {
        try {
            document.getElementById('geminiExportBadge')?.remove();
        } catch {}
        window.__gemExporterInjected = false;
        window.__gemExporterScrollAll = null;
    }
    window.__gemExporterInjected = true;

    const Storage = (typeof StorageService !== 'undefined') ? StorageService : (window.StorageService || null);
    const Scraper = (typeof DomScraper !== 'undefined') ? DomScraper : (window.DomScraper || null);
    const Assets = (typeof AssetFetcher !== 'undefined') ? AssetFetcher : (window.AssetFetcher || null);

    function getAccountSlot() {
        const m = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
        return m ? ('u' + m[1]) : 'u0';
    }

    let currentLang = 'zh';
    function isZh() {
        return (currentLang || '').toLowerCase().startsWith('zh');
    }

    try {
        chrome.storage.local.get(['gemini_exporter_lang'], d => {
            if (d.gemini_exporter_lang) currentLang = d.gemini_exporter_lang;
            else currentLang = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
            refreshInitialBadge();
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.gemini_exporter_lang) {
                currentLang = changes.gemini_exporter_lang.newValue || 'zh';
                refreshInitialBadge();
            }
        });
    } catch {}

    function ensureBadge() {
        let existing = document.getElementById('geminiExportBadge');
        if (existing) return existing;
        const zh = isZh();
        const div = document.createElement('div');
        div.id = 'geminiExportBadge';
        div.innerHTML = `<span class="pulse"></span><span id="geminiExportBadgeText">${zh ? '检测中…' : 'Checking...'}</span>`;
        div.title = zh ? '点此打开批量导出页' : 'Click to open Export Workbench';
        div.addEventListener('click', () => {
            try {
                const p = chrome.runtime.sendMessage({ action: 'openOptions' });
                if (p && p.catch) p.catch(() => {});
            } catch {}
        });
        (document.body || document.documentElement).appendChild(div);
        refreshInitialBadge();
        return div;
    }

    async function refreshInitialBadge() {
        try {
            const slot = getAccountSlot();
            let convs = Storage ? await Storage.getConversations(slot) : [];
            if (convs && convs.length > 0) {
                updateBadge(convs.length, 0);
            } else {
                const zh = isZh();
                updateBadge(0, 0, zh ? '就绪 (0 条)' : 'Ready (0)');
            }
        } catch {}
    }

    async function syncOnce() {
        try {
            if (!Scraper || typeof Scraper.getConversationLinks !== 'function') return 0;
            const links = Scraper.getConversationLinks();
            if (!links || !links.length) {
                if (typeof Scraper.tryExpandRecents === 'function') Scraper.tryExpandRecents();
                return 0;
            }
            const dedup = links.filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
            let mergedLen = await upsertConversations(dedup, 'dom-sync');
            return mergedLen;
        } catch (e) {
            return 0;
        }
    }

    function ensureBadgeAndText() {
        const badge = ensureBadge();
        const txt = document.getElementById('geminiExportBadgeText');
        return { badge, txt };
    }

    function updateBadge(mergedLen, visible, overrideText) {
        try {
            const { txt, badge } = ensureBadgeAndText();
            if (!txt) return;
            if (overrideText) {
                txt.textContent = overrideText;
                return;
            }
            const zh = isZh();
            txt.textContent = zh ? `已同步 ${mergedLen} 条` : `${mergedLen} synced`;
            const slot = getAccountSlot();
            if (badge) {
                if (slot !== 'u0') {
                    badge.title = (zh ? `当前账号 (${slot.toUpperCase()}): 点击打开导出页` : `Account (${slot.toUpperCase()}): Click to open Export`);
                } else {
                    badge.title = (zh ? '点此打开批量导出页' : 'Click to open Export Workbench');
                }
            }
        } catch (e) {
            console.warn('[Gemini Exporter] updateBadge err', e);
        }
    }

    const isRealTitle = (typeof globalThis.isRealTitle === 'function')
        ? globalThis.isRealTitle
        : function isRealTitle(title, id) {
            if (!title || typeof title !== 'string') return false;
            let t = title.trim();
            if (t.length < 2) return false;
            if (id) {
                let cleanId = String(id).replace(/^c_/, '').trim();
                let cleanT = t.replace(/^c_/, '').trim();
                if (cleanT === cleanId) return false;
                if (cleanT.startsWith('未命名对话(') || cleanT.startsWith('Untitled(')) return false;
            }
            if (/^(未命名对话|Untitled conversation|Untitled|Document|Gemini|New chat|新对话|Search|搜索)$/i.test(t)) return false;
            if (/^Google Account/i.test(t)) return false;
            if (/^[a-f0-9_-]{8,64}$/i.test(t)) return false;
            return true;
        };

    let __storageWriteQueue = Promise.resolve();

    function upsertConversations(incomingItems, source) {
        if (!incomingItems || !incomingItems.length) return Promise.resolve(0);
        __storageWriteQueue = __storageWriteQueue.then(async () => {
            try {
                const slot = getAccountSlot();
                const existing = Storage ? await Storage.getConversations(slot) : [];
                const map = new Map();
                existing.forEach(c => {
                    if (!c || !c.id) return;
                    const nid = String(c.id).replace(/^c_/, '').trim();
                    c.id = nid;
                    map.set(nid, c);
                });
                let now = Date.now();
                let changed = 0;

                incomingItems.forEach((c, idx) => {
                    if (!c || !c.id) return;
                    const nid = String(c.id).replace(/^c_/, '').trim();
                    c.id = nid;
                    const old = map.get(nid);

                    let resolvedTitle = old?.title;
                    if (isRealTitle(c.title, nid)) {
                        resolvedTitle = c.title.trim().slice(0, 120);
                    } else if (!isRealTitle(old?.title, nid)) {
                        resolvedTitle = c.title || old?.title || '未命名对话';
                    }

                    if (!old) {
                        changed++;
                    } else if (old.title !== resolvedTitle || (!old.timestamp && c.timestamp)) {
                        changed++;
                    }
                    map.set(nid, {
                        ...(old || {}),
                        ...c,
                        id: nid,
                        title: resolvedTitle,
                        timestamp: c.timestamp || (old && old.timestamp) || null,
                        lastSeen: (old && old.lastSeen) || new Date(now - idx).toISOString(),
                        source: source || (old && old.source) || 'unknown',
                        accountSlot: slot
                    });
                });

                const merged = Array.from(map.values());
                merged.sort((a, b) => {
                    let tsA = a.timestamp ? (typeof a.timestamp === 'string' ? new Date(a.timestamp).getTime() : a.timestamp) : (a.lastSeen ? new Date(a.lastSeen).getTime() : 0);
                    let tsB = b.timestamp ? (typeof b.timestamp === 'string' ? new Date(b.timestamp).getTime() : b.timestamp) : (b.lastSeen ? new Date(b.lastSeen).getTime() : 0);
                    return tsB - tsA;
                });

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
                } catch (e) {}

                updateBadge(merged.length, incomingItems.length);
                return merged.length;
            } catch (e) {
                if (e?.message?.includes('Extension context invalidated')) return 0;
                console.error('[Gemini Exporter] upsertConversations failed', e);
            }
        });
        return __storageWriteQueue;
    }

    async function tryBatchExecuteFull(forceOpts) {
        if (window.__gemExporterDeepScanPromise) return null;
        try {
            let C = (typeof GeminiAPIClient !== 'undefined') ? GeminiAPIClient : window.GeminiAPIClient;
            if (!C) return null;
            let client = new C();
            const slot = getAccountSlot();
            const beforeList = Storage ? await Storage.getConversations(slot) : [];
            const beforeMap = new Map(beforeList.map(c => [c.id, c]));
            let useIncremental = beforeList.length > 30;
            if (forceOpts?.forceFull) useIncremental = false;
            if (forceOpts?.forceIncremental) useIncremental = true;

            const effectiveMaxPages = forceOpts?.maxPages || (useIncremental ? 2 : 2000);

            window.__gemExporterAborted = false;
            let saveQueue = Promise.resolve();
            let all = await client.getAllConversations(effectiveMaxPages, (prog) => {
                const badge = document.getElementById('geminiExportBadgeText');
                if (badge) {
                    if (prog.stoppedEarly) badge.textContent = `已同步 ${prog.total} 条 ✓`;
                    else badge.textContent = `正在同步: 已获取 ${prog.total} 条${prog.hasMore?'…':''}`;
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
                } catch (e) {}

                if (prog.batch && prog.batch.length) {
                    saveQueue = saveQueue.then(() => upsertConversations(prog.batch, 'batchexecute'));
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
                } catch {}
            }

            if (all && all.conversations && all.conversations.length) {
                let mergedLen = await upsertConversations(all.conversations, 'batchexecute');
                const badge = document.getElementById('geminiExportBadgeText');
                if (badge) badge.textContent = `已同步 ${mergedLen} 条 ✓`;
                try {
                    const _p = chrome.runtime.sendMessage({
                        action: 'scanProgress',
                        done: 1,
                        total: 1,
                        percent: 100,
                        count: mergedLen,
                        title: `同步完成，共 ${mergedLen} 条`
                    });
                    if (_p && _p.catch) _p.catch(() => {});
                } catch (e) {}
                return { count: mergedLen, diagnostics: all.diagnostics };
            }
        } catch (e) {
            console.debug('[Gemini Exporter] batch exec fail', e.message || e);
        }
        return null;
    }

    // Network ids hook listener
    window.addEventListener('message', async (event) => {
        const d = event.data;
        if (!d || d.type !== '__gemExporterNetworkIds') return;
        const ids = d.ids || [];
        if (!ids.length) return;
        try {
            let mockItems = ids.map(id => ({
                id,
                title: '未命名对话(' + id.slice(0, 6) + ')',
                href: `https://gemini.google.com/app/${id}`,
                url: `https://gemini.google.com/app/${id}`
            }));
            let mergedLen = await upsertConversations(mockItems, 'network:' + (d.source || ''));
            if (!window.__gemExporterDeepScanPromise) {
                const badgeTxt = document.getElementById('geminiExportBadgeText');
                if (badgeTxt) badgeTxt.textContent = `已同步 ${mergedLen} 条`;
                else ensureBadge();
            }
        } catch (e) {}
    });

    // Message router
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'deepScan') {
            (async () => {
                try {
                    let res = await tryBatchExecuteFull({
                        forceIncremental: msg.mode === 'incremental',
                        forceFull: msg.mode === 'full'
                    });
                    sendResponse({ success: true, count: res?.count || 0, diagnostics: res?.diagnostics });
                } catch (e) {
                    sendResponse({ success: false, error: e.message });
                }
            })();
            return true;
        }

        if (msg.action === 'stopDeepScan') {
            window.__gemExporterAborted = true;
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
                try {
                    let C = (typeof GeminiAPIClient !== 'undefined') ? GeminiAPIClient : window.GeminiAPIClient;
                    if (C) {
                        let client = new C();
                        let detail = await client.getConversationDetail(cid, msg.targetSid || null);
                        if (detail && detail.messages) {
                            sendResponse({ success: true, data: detail, source: 'batchexecute' });
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('[Gemini Exporter] batchexecute detail fail, fallback to DOM', e.message);
                }
                try {
                    if (Scraper) {
                        let chat = await Scraper.contentFetchChatDetail(cid);
                        sendResponse({ success: true, data: chat, source: 'dom' });
                        return;
                    }
                } catch (e) {
                    sendResponse({ success: false, error: e.message || String(e) });
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

    async function autoInitSync() {
        ensureBadge();
        await refreshInitialBadge();
        await syncOnce();
        setTimeout(async () => {
            try {
                if (!window.__gemExporterDeepScanPromise) {
                    await tryBatchExecuteFull({ forceIncremental: true, maxPages: 1 });
                }
            } catch {}
        }, 1500);
    }

    if (window.__gemExporterInterval) clearInterval(window.__gemExporterInterval);
    window.__gemExporterInterval = setInterval(() => {
        if (window.__gemExporterDeepScanPromise) return;
        syncOnce();
    }, 3000);

    window.addEventListener('popstate', () => {
        setTimeout(() => {
            refreshInitialBadge();
            syncOnce();
        }, 300);
    });

    if (document.readyState !== 'loading') {
        autoInitSync();
    } else {
        document.addEventListener('DOMContentLoaded', autoInitSync, { once: true });
    }

    console.log('[Gemini Exporter Content Coordinator] ready');
})();
