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
        chrome.storage.local.get(['gemini_exporter_lang', 'gemini_dev_mode'], d => {
            if (d.gemini_exporter_lang) currentLang = d.gemini_exporter_lang;
            else currentLang = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
            // Expose dev mode flag so gemini_parser.js (content-script context) can detect it.
            // The options page applies the 'dev-mode' CSS class to *its own* document.body,
            // which is inaccessible here; reading storage is the only reliable bridge.
            window.__gemExporterDevMode = !!d.gemini_dev_mode;
            refreshInitialBadge();
        });
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.gemini_exporter_lang) {
                currentLang = changes.gemini_exporter_lang.newValue || 'zh';
                refreshInitialBadge();
            }
            if (area === 'local' && changes.gemini_dev_mode) {
                window.__gemExporterDevMode = !!changes.gemini_dev_mode.newValue;
            }
        });
    } catch {}

    let __lastKnownCount = null;

    function ensureBadge() {
        let existing = document.getElementById('geminiExportBadge');
        if (existing) {
            if (!existing.isConnected) {
                (document.body || document.documentElement).appendChild(existing);
            } else if (document.body && existing.parentElement !== document.body) {
                document.body.appendChild(existing);
            }
            return existing;
        }
        const zh = isZh();
        const div = document.createElement('div');
        div.id = 'geminiExportBadge';
        const initText = (__lastKnownCount !== null)
            ? (zh ? `已同步 ${__lastKnownCount} 条` : `${__lastKnownCount} synced`)
            : (zh ? '就绪' : 'Ready');
        div.innerHTML = `<span class="pulse"></span><span id="geminiExportBadgeText">${initText}</span>`;
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
    const cleanTitle = (t) => (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle ? GeminiUtils.cleanTitle(t) : (t || '').trim());

    function extractActiveChatTitle(activeId) {
        if (!activeId) return null;
        // 1. From DOM conversation title / header elements (Tier: 'dom')
        const titleEls = document.querySelectorAll('[data-test-id="conversation-title"], .conversation-title, h1, [class*="conversation-title"]');
        for (const el of titleEls) {
            let t = cleanTitle(el.textContent || '');
            if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
        }
        // 2. From active sidebar element (Tier: 'dom')
        const activeLink = document.querySelector(`a[href*="${activeId}"]`);
        if (activeLink) {
            let t = cleanTitle(activeLink.querySelector('.title, [class*="title"]')?.textContent || activeLink.textContent || '');
            if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
        }
        // 3. From first user query on the page (Tier: 'sniff')
        const firstUserQuery = document.querySelector('user-query .query-text, user-query [data-test-id="query-text"], user-query p, user-query');
        if (firstUserQuery) {
            let t = cleanTitle((firstUserQuery.textContent || '').trim().slice(0, 60).replace(/\n+/g, ' '));
            if (isRealTitle(t, activeId)) return { title: t, source: 'sniff' };
        }
        // 4. From document.title only if it is a real title (Tier: 'sniff')
        if (document.title) {
            let t = cleanTitle(document.title);
            if (isRealTitle(t, activeId)) return { title: t, source: 'sniff' };
        }
        return null;
    }

    let __fetchingDetailMap = new Map();
    function scheduleActiveChatDetailFetch(activeId) {
        if (!activeId || __fetchingDetailMap.has(activeId)) return;
        __fetchingDetailMap.set(activeId, Date.now());
        setTimeout(async () => {
            try {
                // Only fetch if this conversation is NOT already stored with a known timestamp
                const slot = getAccountSlot();
                const existing = Storage ? await Storage.getConversations(slot) : [];
                const found = existing.find(c => String(c.id).replace(/^c_/, '') === activeId);
                if (found && (found.updatedAt || found.timestamp)) {
                    return;
                }

                const C = (typeof GeminiAPIClient !== 'undefined') ? GeminiAPIClient : (typeof globalThis.GeminiAPIClient !== 'undefined' ? globalThis.GeminiAPIClient : null);
                if (!C) return;
                const client = new C();
                const d = await client.getConversationDetail(activeId);
                if (d && d.id) {
                    const nid = String(d.id).replace(/^c_/, '').trim();
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
                console.debug('[Gemini Exporter] scheduleActiveChatDetailFetch err', err);
            } finally {
                setTimeout(() => __fetchingDetailMap.delete(activeId), 10000);
            }
        }, 200);
    }

    async function syncOnce() {
        try {
            const items = [];
            // 1. Check current active page chat
            const m = location.pathname.match(/\/app\/(c_)?([A-Za-z0-9_-]{8,})/);
            let activeId = null;
            if (m) {
                activeId = m[2].replace(/^c_/, '');
                const activeTitleObj = extractActiveChatTitle(activeId);
                if (activeTitleObj && activeTitleObj.title) {
                    const titlesMap = {};
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
            console.debug('[Gemini Exporter] syncOnce err', e);
            return 0;
        }
    }

    function ensureBadgeAndText() {
        const badge = ensureBadge();
        const txt = document.getElementById('geminiExportBadgeText');
        return { badge, txt };
    }

    function updateBadge(mergedLen, visible, overrideText, isSyncing = false) {
        try {
            const { txt, badge } = ensureBadgeAndText();
            if (!txt) return;
            if (badge) {
                if (isSyncing) badge.classList.add('syncing');
                else badge.classList.remove('syncing');
            }
            if (typeof mergedLen === 'number' && mergedLen >= 0) {
                __lastKnownCount = mergedLen;
            }
            let targetText = '';
            if (overrideText) {
                targetText = overrideText;
            } else {
                const zh = isZh();
                targetText = zh ? `已同步 ${mergedLen} 条` : `${mergedLen} synced`;
            }
            if (txt.textContent !== targetText) {
                txt.textContent = targetText;
            }
            const slot = getAccountSlot();
            if (badge) {
                const zh = isZh();
                const targetTitle = (slot !== 'u0')
                    ? (zh ? `当前账号 (${slot.toUpperCase()}): 点击打开导出页` : `Account (${slot.toUpperCase()}): Click to open Export`)
                    : (zh ? '点此打开批量导出页' : 'Click to open Export Workbench');
                if (badge.title !== targetTitle) {
                    badge.title = targetTitle;
                }
            }
        } catch (e) {
            console.warn('[Gemini Exporter] updateBadge err', e);
        }
    }

    const isRealTitle = (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle)
        ? GeminiUtils.isRealTitle
        : ((typeof globalThis.GeminiUtils !== 'undefined' && globalThis.GeminiUtils.isRealTitle)
            ? globalThis.GeminiUtils.isRealTitle
            : (t, id) => !!(t && String(t).trim().length > 1));

    const resolveTitle = (typeof GeminiUtils !== 'undefined' && GeminiUtils.resolveTitle)
        ? GeminiUtils.resolveTitle
        : ((typeof globalThis.GeminiUtils !== 'undefined' && globalThis.GeminiUtils.resolveTitle)
            ? globalThis.GeminiUtils.resolveTitle
            : (chat) => ({ title: chat?.title || '未命名对话', source: 'default' }));

    let __storageWriteQueue = Promise.resolve();

    function upsertConversations(incomingItems, source, forceWrite = false) {
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

                    const mergedTitles = { ...(old?.titles || {}) };
                    if (c.titles && typeof c.titles === 'object') {
                        Object.assign(mergedTitles, c.titles);
                    }
                    if (c.titleSource && c.title) {
                        const cleanT = cleanTitle(c.title);
                        if (cleanT && (isRealTitle(cleanT, nid) || c.titleSource === 'takeout')) {
                            mergedTitles[c.titleSource] = cleanT;
                        }
                    } else if (c.title && !mergedTitles.legacy && !mergedTitles.rpc && !mergedTitles.dom && !mergedTitles.takeout) {
                        const cleanT = cleanTitle(c.title);
                        if (cleanT && isRealTitle(cleanT, nid)) {
                            mergedTitles.legacy = cleanT;
                        }
                    }

                    const tempChat = {
                        id: nid,
                        titles: mergedTitles,
                        title: c.title || old?.title,
                        titleSource: c.titleSource || old?.titleSource
                    };

                    const resolved = resolveTitle(tempChat);
                    const resolvedTitle = resolved.title;
                    const resolvedSource = resolved.source;

                    // Calculate updated timestamp and updatedAt
                    let cUpdated = c.updatedAt || c.timestamp || null;
                    if (typeof cUpdated === 'string') cUpdated = new Date(cUpdated).getTime();
                    let oldUpdated = old?.updatedAt || old?.timestamp || null;
                    if (typeof oldUpdated === 'string') oldUpdated = new Date(oldUpdated).getTime();

                    let isRpcSource = source === 'network-list' || c.titleSource === 'rpc';
                    let bestUpdatedAt = oldUpdated;
                    if (cUpdated && (isRpcSource || !bestUpdatedAt || cUpdated > bestUpdatedAt)) {
                        bestUpdatedAt = cUpdated;
                    }

                    let cCreated = c.createdAt || null;
                    if (typeof cCreated === 'string') cCreated = new Date(cCreated).getTime();
                    let oldCreated = old?.createdAt || null;
                    if (typeof oldCreated === 'string') oldCreated = new Date(oldCreated).getTime();
                    let bestCreatedAt = oldCreated || cCreated || null;
                    if (cCreated && oldCreated && cCreated < oldCreated) {
                        bestCreatedAt = cCreated;
                    }

                    let bestTimestamp = isRpcSource ? (cUpdated || bestUpdatedAt) : (bestUpdatedAt || old?.timestamp || c.timestamp || null);

                    if (!old) {
                        changed++;
                    } else if (old.title !== resolvedTitle || (!old.timestamp && bestTimestamp) || (bestUpdatedAt && bestUpdatedAt !== oldUpdated)) {
                        changed++;
                    }
                    map.set(nid, {
                        ...(old || {}),
                        ...c,
                        id: nid,
                        titles: mergedTitles,
                        title: resolvedTitle,
                        titleSource: resolvedSource,
                        timestamp: bestTimestamp,
                        updatedAt: bestUpdatedAt || bestTimestamp,
                        createdAt: bestCreatedAt,
                        sidebarIndex: typeof c.sidebarIndex === 'number' ? c.sidebarIndex : old?.sidebarIndex,
                        lastSeen: (c.lastSeen || (old && old.lastSeen) || new Date(now - idx).toISOString()),
                        source: source || (old && old.source) || 'unknown',
                        accountSlot: slot
                    });
                });

                const merged = Array.from(map.values());
                const getEffectiveTime = (typeof GeminiUtils !== 'undefined' && GeminiUtils.getEffectiveTimestamp)
                    ? GeminiUtils.getEffectiveTimestamp
                    : (conv) => {
                        if (!conv) return 0;
                        const raw = conv.updatedAt || conv.timestamp || conv.chatTime || conv.createdAt || 0;
                        return typeof raw === 'string' ? new Date(raw).getTime() : (raw || 0);
                    };

                merged.sort((a, b) => {
                    let tsA = getEffectiveTime(a);
                    let tsB = getEffectiveTime(b);
                    if (tsA !== tsB) return tsB - tsA;

                    let idxA = typeof a.sidebarIndex === 'number' ? a.sidebarIndex : 999999;
                    let idxB = typeof b.sidebarIndex === 'number' ? b.sidebarIndex : 999999;
                    if (idxA !== idxB) return idxA - idxB;

                    let lsA = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
                    let lsB = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
                    return lsB - lsA;
                });

                if (!forceWrite && changed === 0) {
                    if (__lastKnownCount !== merged.length) {
                        updateBadge(merged.length, incomingItems.length);
                    }
                    return merged.length;
                }

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

        // 防重入：将本次执行的 Promise 赋给全局标志位，finally 中清除
        let _resolve;
        window.__gemExporterDeepScanPromise = new Promise(r => { _resolve = r; });

        try {
            document.getElementById('geminiExportBadge')?.classList.add('syncing');
            let C = (typeof GeminiAPIClient !== 'undefined') ? GeminiAPIClient : window.GeminiAPIClient;
            if (!C) return null;
            let client = new C();
            // 暴露给 stopDeepScan 处理器，确保 window 标志与 client 实例双同步
            window.__gemExporterActiveClient = client;
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
                    saveQueue = saveQueue.then(() => upsertConversations(prog.batch, 'batchexecute', true));
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
                let mergedLen = await upsertConversations(all.conversations, 'batchexecute', true);
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
        } finally {
            document.getElementById('geminiExportBadge')?.classList.remove('syncing');
            window.__gemExporterActiveClient = null;
            window.__gemExporterDeepScanPromise = null;
            if (_resolve) _resolve();
        }
        return null;
    }

    // Network batchexecute & ids hook listener
    window.addEventListener('message', async (event) => {
        if (event.origin !== location.origin) return;
        const d = event.data;
        if (!d) return;

        // 1. Captured batchexecute response (Sidebar scroll, search, page load, opening any chat)
        if (d.type === 'GEMINI_NETWORK_BATCHEXECUTE') {
            const { text, slot } = d.payload || {};
            if (!text) return;
            try {
                let parser = (typeof GeminiResponseParserClass !== 'undefined') ? GeminiResponseParserClass : (typeof globalThis.GeminiResponseParserClass !== 'undefined' ? globalThis.GeminiResponseParserClass : null);
                if (!parser) return;

                // If response contains conversation list (sidebar scroll or search)
                if (text.includes('MaZiqc')) {
                    try {
                        const listRes = parser.parseList(text);
                        if (listRes && listRes.conversations && listRes.conversations.length) {
                            await upsertConversations(listRes.conversations, 'network-list');
                        }
                    } catch (e) {
                        console.debug('[Gemini Exporter] parseList err', e);
                    }
                }

                // If response contains conversation detail (opening any chat)
                if (text.includes('hNvQHb')) {
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
                                }], 'network-detail');
                            }
                        }
                    } catch (e) {
                        console.debug('[Gemini Exporter] parseDetail err', e);
                    }
                }
            } catch (err) {
                console.debug('[Gemini Exporter] batchexecute hook process error', err);
            }
            return;
        }

        // 2. Fallback network ids hook listener
        if (d.type === '__gemExporterNetworkIds') {
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
        }
    });

    // Message router
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'ping') {
            sendResponse({
                ok: true,
                version: (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '1.4.1'
            });
            return true;
        }

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
            try { window.__gemExporterActiveClient && window.__gemExporterActiveClient.abort(); } catch {}
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
                    const slot = msg.accountSlot || detectSlot() || 'u0';
                    try {
                        if (Storage) {
                            const list = await Storage.getConversations(slot);
                            const item = list.find(c => normId(c.id) === nid);
                            if (item) {
                                const setTitleBySourceFn = (typeof GeminiUtils !== 'undefined' && GeminiUtils.setTitleBySource)
                                    ? GeminiUtils.setTitleBySource
                                    : (it, src, val) => {
                                        it.titles = it.titles || {};
                                        it.titles[src] = val;
                                        const res = resolveTitle(it);
                                        it.title = res.title;
                                        it.titleSource = res.source;
                                    };
                                setTitleBySourceFn(item, detectedSource, chatObj.title);
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
                            if (window.__gemExporterDevMode) {
                                console.warn('[Gemini Exporter] batchexecute returned empty messages, fallback to DOM', cid, batchexecuteEmptyDebug);
                            }
                        }
                    }
                } catch (e) {
                    batchexecuteEmptyDebug = { error: e.message };
                    if (window.__gemExporterDevMode) {
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
                            if (window.__gemExporterDevMode) {
                                console.warn('[Gemini Exporter] DOM fallback returned empty messages', cid, 'messages', chat?.messages?.length, 'has _raw', !!chat?._raw);
                            }
                            // 合并 batchexecute 与 DOM 的诊断，一并返回给 background
                            const mergedDebug = { batchexecuteEmptyDebug, domDebug: chat?._debug || null, domHtmlLen: chat?._debug?.htmlLen || null };
                            sendResponse({ success: true, data: { ...chat, _empty: true, error: chat?.error || 'DOM 返回内容为空', _debug: mergedDebug, _debug_dom_empty: true }, source: 'dom' });
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

    async function autoInitSync() {
        ensureBadge();
        await refreshInitialBadge();
        await syncOnce();
    }

    let __syncDebounceTimer = null;
    function debouncedSyncOnce(delay = 350) {
        if (__syncDebounceTimer) clearTimeout(__syncDebounceTimer);
        __syncDebounceTimer = setTimeout(() => {
            __syncDebounceTimer = null;
            if (window.__gemExporterDeepScanPromise) return;
            syncOnce();
        }, delay);
    }

    if (window.__gemExporterInterval) clearInterval(window.__gemExporterInterval);
    window.__gemExporterInterval = setInterval(() => {
        if (window.__gemExporterDeepScanPromise) return;
        syncOnce();
    }, 15000);

    let __lastObservedUrl = location.href;
    setInterval(() => {
        if (location.href !== __lastObservedUrl) {
            __lastObservedUrl = location.href;
            debouncedSyncOnce(400);
        }
    }, 500);

    window.addEventListener('popstate', () => {
        debouncedSyncOnce(300);
    });

    try {
        const titleEl = document.querySelector('title');
        if (titleEl) {
            new MutationObserver(() => {
                debouncedSyncOnce(500);
            }).observe(titleEl, { childList: true, characterData: true, subtree: true });
        }
    } catch {}

    if (document.readyState !== 'loading') {
        autoInitSync();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            ensureBadge();
            autoInitSync();
        }, { once: true });
    }

    console.log('[Gemini Exporter Content Coordinator] ready');
})();
