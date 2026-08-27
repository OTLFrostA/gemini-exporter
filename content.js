// content.js - Gemini Exporter content script
// Handles conversation synchronization and in-page detail extraction
(() => {
    // ---- Global flags (survive hot reload) ----
    if (typeof window.__gemExporterDeepScanPromise === 'undefined') window.__gemExporterDeepScanPromise = null;

    if (window.__gemExporterInjected) {
        console.log('[Gemini Exporter] hot reload detected - re-init badge & scan');
        try {
            document.getElementById('geminiExportBadge')?.remove();
        } catch {}
        // Do NOT clear running flag on hot reload – keep deep scan protection
        window.__gemExporterInjected = false;
        window.__gemExporterScrollAll = null;
    }
    window.__gemExporterInjected = true;
    console.log('[Gemini Exporter] injected at', document.readyState);

    // ----- Helpers: badge -----
    function ensureBadge() {
        let existing = document.getElementById('geminiExportBadge');
        if (existing) {
            // remove duplicate badges if any (loop bug leftover)
            document.querySelectorAll('#geminiExportBadge').forEach((el, i) => {
                if (i > 0) el.remove();
            });
            return existing;
        }
        let isZh = (navigator.language || '').toLowerCase().startsWith('zh');
        chrome.storage.local.get(['gemini_exporter_lang'], d => {
            if (d.gemini_exporter_lang) isZh = d.gemini_exporter_lang === 'zh';
        });
        const div = document.createElement('div');
        div.id = 'geminiExportBadge';
        div.innerHTML = `<span class="pulse"></span><span id="geminiExportBadgeText">${isZh ? '初始化…' : 'Initializing...'}</span>`;
        div.title = isZh ? '点此打开批量导出页' : 'Click to open Export Workbench';
        div.addEventListener('click', () => {
            try {
                const p = chrome.runtime.sendMessage({
                    action: 'openOptions'
                });
                if (p && p.catch) p.catch(() => {});
            } catch {}
        });
        (document.body || document.documentElement).appendChild(div);
        refreshInitialBadge();
        return div;
    }

    function getAccountSlot() {
        const m = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
        return m ? ('u' + m[1]) : 'u0';
    }

    function getStorageKeys() {
        const slot = getAccountSlot();
        if (slot === 'u0') {
            return {
                slot,
                convKey: 'gemini_conversations',
                countKey: 'gemini_last_count',
                syncKey: 'gemini_last_sync'
            };
        }
        return {
            slot,
            convKey: `gemini_conversations_${slot}`,
            countKey: `gemini_last_count_${slot}`,
            syncKey: `gemini_last_sync_${slot}`
        };
    }

    async function refreshInitialBadge() {
        try {
            const { convKey, countKey } = getStorageKeys();
            const store = await chrome.storage.local.get([convKey, countKey]);
            const c = store[convKey]?.length ?? store[countKey] ?? 0;
            if (c > 0) updateBadge(c, 0);
        } catch {}
    }

    function ensureBadgeAndText() {
        const badge = ensureBadge();
        const txt = document.getElementById('geminiExportBadgeText');
        return {
            badge,
            txt
        };
    }

    function updateBadge(mergedLen, visible, overrideText) {
        try {
            const {
                txt,
                badge
            } = ensureBadgeAndText();
            if (!txt) return;
            if (overrideText) {
                txt.textContent = overrideText;
                return;
            }
            const isZh = (navigator.language || '').toLowerCase().startsWith('zh');
            txt.textContent = isZh ? `已同步 ${mergedLen} 条` : `${mergedLen} synced`;
            const slot = getAccountSlot();
            if (badge && slot !== 'u0') {
                badge.title = (isZh ? `当前账号 (${slot.toUpperCase()}): 点击打开导出页` : `Account (${slot.toUpperCase()}): Click to open Export`);
            }
        } catch (e) {
            console.warn('[Gemini Exporter] updateBadge err', e);
        }
    }

    let __storageWriteQueue = Promise.resolve();

    function upsertConversations(incomingItems, source) {
        if (!incomingItems || !incomingItems.length) return Promise.resolve(0);
        __storageWriteQueue = __storageWriteQueue.then(async () => {
            try {
                const { slot, convKey, countKey, syncKey } = getStorageKeys();
                const data = await chrome.storage.local.get([convKey, syncKey, 'gemini_account_slots']);
                const existing = data[convKey] || [];
                const map = new Map(existing.map(c => [c.id, c]));
                let now = Date.now();
                let changed = 0;

                incomingItems.forEach((c, idx) => {
                    if (!c || !c.id) return;
                    const old = map.get(c.id);
                    if (!old || old.title !== c.title) changed++;
                    map.set(c.id, {
                        ...(old || {}),
                        ...c,
                        lastSeen: new Date(now - idx).toISOString(),
                        source: source || (old && old.source) || 'unknown',
                        accountSlot: slot
                    });
                });

                const merged = Array.from(map.values());
                merged.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

                const slotsMeta = data.gemini_account_slots || {};
                slotsMeta[slot] = {
                    slot,
                    name: slot === 'u0' ? '默认账号 (u0)' : `账号 ${slot.toUpperCase()}`,
                    count: merged.length,
                    lastSync: new Date().toISOString()
                };

                // Throttle storage writes if nothing actually changed (no new chats, no title updates)
                if (changed === 0 && incomingItems.length > 0) {
                    let lastSyncStr = data[syncKey] || '';
                    let lastSyncTime = lastSyncStr ? new Date(lastSyncStr).getTime() : 0;
                    if (Date.now() - lastSyncTime < 5000) {
                        updateBadge(merged.length, incomingItems.length);
                        return merged.length;
                    }
                }

                await chrome.storage.local.set({
                    [convKey]: merged,
                    [syncKey]: new Date().toISOString(),
                    [countKey]: merged.length,
                    gemini_account_slots: slotsMeta
                });

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

    // ----- Batch execute (batchexecute first) -----
    async function tryBatchExecuteFull(forceOpts) {
        if (window.__gemExporterDeepScanPromise) {
            console.log('[Gemini Exporter] batch already running, return existing');
            return null; // let caller wait via promise path
        }
        try {
            if (typeof GeminiAPIClient === 'undefined' && typeof window.GeminiAPIClient === 'undefined') return null;
            let C = (typeof GeminiAPIClient !== 'undefined') ? GeminiAPIClient : window.GeminiAPIClient;
            let client = new C();
            if (typeof ensureCreds === 'function') {
                try { await ensureCreds(); } catch {}
            }
            let map = (await chrome.storage.local.get(['gemini_credentials_map'])).gemini_credentials_map || {};
            if (!Object.keys(map).length) {
                let at = typeof extractAtFromPage === 'function' ? extractAtFromPage() : '';
                if (!at && typeof window.__gemExporterExtractAt === 'function') at = window.__gemExporterExtractAt();
                if (!at) return null;
            }
            
            const { convKey } = getStorageKeys();
            const freshBefore = await chrome.storage.local.get([convKey]);
            const beforeList = freshBefore[convKey] || [];
            const beforeMap = new Map(beforeList.map(c => [c.id, c]));
            let useIncremental = beforeList.length > 30;
            if (forceOpts?.forceFull) useIncremental = false;
            if (forceOpts?.forceIncremental) useIncremental = true;
            
            let all = await client.getAllConversations(forceOpts?.maxPages || 2000, (prog) => {
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
            }, null, {
                existingMap: beforeMap,
                incremental: useIncremental,
                unchangedThreshold: 20
            });
            
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
                return mergedLen;
            }
        } catch (e) {
            console.debug('[Gemini Exporter] batch exec fail, will fallback scroll', e.message || e);
        }
        return null;
    }

    // ----- 0. Network ids via MAIN world hook -----
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
            // only update badge if not in deep scan (prevents flicker)
            if (!window.__gemExporterDeepScanPromise) {
                const badgeTxt = document.getElementById('geminiExportBadgeText');
                if (badgeTxt) badgeTxt.textContent = `已同步 ${mergedLen} 条`;
                else ensureBadge();
            }
        } catch (e) {
            console.warn('[Robust network merge err]', e);
        }
    });

    // ----- 1. DOM scan -----
    function getConversationLinks() {
        const sels = [
            'a[href*="/app/"]',
            '[data-test-id="conversation"] a',
            'bard-sidenav a[href*="/app/"]',
            'div[role="navigation"] a[href*="/app/"]'
        ];
        let nodes = [];
        for (const sel of sels) {
            try {
                document.querySelectorAll(sel).forEach(a => nodes.push(a));
            } catch {}
        }
        nodes = [...new Set(nodes)];
        if (!nodes.length) nodes = [...document.querySelectorAll('a[href*="/app/"]')];
        return nodes.map(a => {
            let href = a.getAttribute('href') || a.href || '';
            if (!href) return null;
            let m = href.match(/\/app\/(c_)?([A-Za-z0-9_-]{8,})/);
            if (!m) return null;
            let raw = m[2] || m[1];
            if (!raw) return null;
            if (raw.length < 8) return null;
            if (/^(search|images|videos|app)$/i.test(raw)) return null;
            let id = raw.replace(/^c_/, '');
            let title = (a.textContent || a.getAttribute('aria-label') || '').trim().split('\n')[0].trim();
            title = title.replace(/\s{2,}/g, ' ').trim();
            if (!title || title.length < 2) {
                let pp = a.closest('[title]');
                if (pp) title = pp.getAttribute('title').trim();
            }
            if (!title || title.length < 2) title = '未命名对话';
            if (/^(New chat|新对话|Search|搜索|Images|图片|Videos|视频|Library|Gemini)$/i.test(title)) return null;
            let abs = href.startsWith('http') ? href.split('?')[0] : 'https://gemini.google.com' + href.split('?')[0];
            if (/accounts\.google\.com|SignOutOptions/i.test(href) || /accounts\.google\.com/i.test(abs)) return null;
            if (/^Google Account/i.test(title)) return null;
            return {
                id,
                title: title.slice(0, 90),
                href: abs,
                url: abs
            };
        }).filter(Boolean).filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
    }

    function getScrollContainer() {
        try {
            let m = document.querySelector("mat-sidenav-content");
            if (m && m.scrollHeight > m.clientHeight + 20) return m;
        } catch {}
        const sels = [
            '#sidenav-section-content-chats',
            '[data-test-id="sidenav-content"]',
            'bard-sidenav[aria-label="Side Navigation"]',
            'nav[aria-label="Main"]',
            'div[role="navigation"]',
            'div[class*="chat-history"]',
            'div[class*="conversation-list"]'
        ];
        for (const sel of sels) {
            const el = document.querySelector(sel);
            if (el && el.scrollHeight > el.clientHeight + 20) return el;
        }
        const all = document.querySelectorAll('*');
        let best = null,
            bestScore = 0;
        for (const el of all) {
            if (el.scrollHeight <= el.clientHeight + 50) continue;
            const links = el.querySelectorAll ? el.querySelectorAll('a[href*="/app/"]') : [];
            const cnt = links.length || 0;
            if (cnt > 0 && el.scrollHeight > bestScore) {
                best = el;
                bestScore = el.scrollHeight;
            }
        }
        if (best) return best;
        return document.scrollingElement || document.documentElement;
    }

    window.__gemExporterDumpStorage = async () => {
        try {
            let r = await chrome.storage.local.get(['gemini_conversations', 'gemini_last_count', 'gemini_last_sync']);
            console.log('STORAGE_DUMP', JSON.stringify({
                count: r.gemini_conversations?.length,
                last_count: r.gemini_last_count,
                has_sync: !!r.gemini_last_sync,
                sample: r.gemini_conversations?.slice(0, 2)
            }));
            return r;
        } catch (e) {
            console.warn('STORAGE_DUMP err', e);
        }
    };

    async function syncOnce() {
        try {
            const links = getConversationLinks();
            const dedup = links.filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
            
            if (dedup.length === 0) {
                tryExpandRecents();
                return { merged: 0, visible: 0, changed: 0 };
            }
            
            let mergedLen = await upsertConversations(dedup, 'dom-sync');
            
            return {
                merged: mergedLen,
                visible: dedup.length,
                changed: dedup.length // Approximate return metric
            };
        } catch (e) {
            if (!String(e && e.message || e).includes('Extension context invalidated')) console.warn('[Robust sync error]', e.message || e);
            return {
                merged: 0,
                visible: 0,
                error: e.message
            };
        }
    }

    function tryExpandRecents() {
        const btn = document.querySelector('button[aria-label="Toggle Recents"]');
        if (btn && btn.getAttribute('aria-expanded') === 'false') btn.click();
        const btn2 = document.querySelector('[aria-label="Toggle Recents"]');
        if (btn2 && btn2.getAttribute('aria-expanded') === 'false') btn2.click();
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // ----- 2. scrollToBottomLoadAll with single-run guard -----
    async function scrollToBottomLoadAll(maxIter = 150, mode) {
        // If already running, return existing promise (prevents double-trigger flicker)
        if (window.__gemExporterDeepScanPromise) {
            console.log('[Gemini Exporter] deep scan already running, returning existing promise');
            return window.__gemExporterDeepScanPromise;
        }

        // Wrap whole scan in a promise stored globally
        const scanPromise = (async () => {
            try {
                let batchCount = await tryBatchExecuteFull(
                    mode === 'full' ? {
                        forceFull: true
                    } : mode === 'incremental' ? {
                        forceIncremental: true
                    } : null
                );
                // tryBatchExecuteFull leaves running true only if it succeeded via inner path;
                // if it returned count, we can finish early
                if (batchCount && batchCount > 0) {
                    return {
                        success: true,
                        count: batchCount,
                        totalMerged: batchCount,
                        source: 'batchexecute'
                    };
                }

                const isIncremental = (mode === 'incremental');
                const effectiveMax = isIncremental ? Math.min(maxIter, 8) : maxIter;
                const { convKey } = getStorageKeys();
                const stored = (await chrome.storage.local.get([convKey]))[convKey] || [];
                const storedIdSet = new Set(stored.map(c => c.id));

                console.log('[Gemini Exporter] scrollToBottomLoadAll start max', effectiveMax, 'mode', mode, 'storedCount', storedIdSet.size);
                const container = getScrollContainer();
                if (!container) {
                    try {
                        const _p = chrome.runtime.sendMessage({
                            action: 'exportProgress',
                            done: 0,
                            total: effectiveMax,
                            title: '未找到滚动容器，请先展开侧边栏'
                        });
                        if (_p && _p.catch) _p.catch(() => {});
                    } catch (e) {};
                    return {
                        success: false,
                        error: 'no container',
                        count: getConversationLinks().length
                    };
                }
                let lastCount = getConversationLinks().length;
                let stable = 0;
                let totalFound = lastCount;
                for (let i = 0; i < effectiveMax; i++) {
                    try {
                        const btns = container.querySelectorAll('button');
                        for (const b of btns) {
                            const t = (b.textContent || '').trim().toLowerCase();
                            if (t.includes('show more') || t.includes('显示更多') || t.includes('加载更多') || t.includes('more')) {
                                if (b.getAttribute('aria-label') && b.getAttribute('aria-label').includes('Toggle')) continue;
                                if (b.offsetParent === null) continue;
                                b.click();
                                await sleep(150);
                            }
                        }
                        try {
                            container.scrollTop = container.scrollHeight;
                        } catch {}
                        try {
                            window.scrollBy(0, 99999);
                        } catch {}
                        try {
                            document.documentElement.scrollTop = document.documentElement.scrollHeight;
                        } catch {}
                        // 把所有可能的侧边栏容器都滚到底，避免只滚了一个导致卡在 29
                        try {
                            document.querySelectorAll('mat-sidenav-content, [data-test-id="sidenav-content"], #sidenav-section-content-chats, div[role="navigation"], bard-sidenav').forEach(el => {
                                try {
                                    el.scrollTop = el.scrollHeight;
                                } catch {}
                            });
                        } catch {}
                        container.dispatchEvent(new Event('scroll', {
                            bubbles: true
                        }));
                        try {
                            container.dispatchEvent(new WheelEvent('wheel', {
                                deltaY: 1200,
                                bubbles: true
                            }));
                        } catch {}
                        const delay = isIncremental ? 160 : (200 + Math.floor(Math.random() * 80));
                        await sleep(delay);

                        const curLinks = getConversationLinks();
                        const curCount = curLinks.length;
                        totalFound = Math.max(totalFound, curCount);

                        // 增量同步智能早退：如果当前可见的尾部会话已全部存在于本地存储，说明已对接历史，立即停止
                        if (isIncremental && storedIdSet.size > 0 && curLinks.length >= 10) {
                            const tail = curLinks.slice(-10);
                            if (tail.every(l => storedIdSet.has(l.id))) {
                                console.log('[Gemini Exporter] Incremental early exit: tail items already known at round', i + 1);
                                break;
                            }
                        }

                        try {
                            const _p = chrome.runtime.sendMessage({
                                action: 'scanProgress',
                                done: i + 1,
                                total: effectiveMax,
                                percent: Math.floor(((i + 1) / effectiveMax) * 100),
                                count: totalFound,
                                title: `正在扫描 (${totalFound} 条)…`
                            });
                            if (_p && _p.catch) _p.catch(() => {});
                        } catch (e) {}
                        const badgeTxt = document.getElementById('geminiExportBadgeText');
                        if (badgeTxt) badgeTxt.textContent = `同步中 | 已获取 ${totalFound} 条`;

                        if (curCount === lastCount) {
                            stable++;
                            if (stable >= 2) {
                                console.log('[Gemini Exporter] stable 2 times, break at', i);
                                break;
                            }
                        } else {
                            stable = 0;
                            lastCount = curCount;
                        }
                        tryExpandRecents();
                    } catch (e) {
                        console.warn('[Robust scroll iter error]', e.message || e);
                        await sleep(100);
                    }
                }
                const finalLinks = getConversationLinks();
                await syncOnce();
                const { convKey, countKey } = getStorageKeys();
                const store = await chrome.storage.local.get([convKey, countKey]);
                const finalCount = store[convKey]?.length || store[countKey] || finalLinks.length;
                console.log('[Gemini Exporter] scrollToBottomLoadAll done visible', finalLinks.length, 'totalMerged', finalCount);
                try {
                    const _p = chrome.runtime.sendMessage({
                        action: 'scanProgress',
                        done: effectiveMax,
                        total: effectiveMax,
                        percent: 100,
                        count: finalCount,
                        title: `同步完成，账号共 ${finalCount} 条会话`
                    });
                    if (_p && _p.catch) _p.catch(() => {});
                } catch (e) {};
                return {
                    success: true,
                    count: finalCount,
                    totalMerged: finalCount,
                    visibleCount: finalLinks.length
                };
            } finally {
                window.__gemExporterDeepScanPromise = null;
                // final badge stabilize
                try {
                    const { convKey } = getStorageKeys();
                    let r = await chrome.storage.local.get([convKey]);
                    let c = r[convKey]?.length || 0;
                    updateBadge(c, getConversationLinks().length, `已同步 ${c} 条 ✓`);
                } catch {}
            }
        })();

        window.__gemExporterDeepScanPromise = scanPromise;
        return scanPromise;
    }

    window.__gemExporterScrollAll = scrollToBottomLoadAll;
    window.__gemExporterGetLinks = getConversationLinks;
    window.__gemExporterSyncOnce = syncOnce;

    // ----- interval: 2000ms, skip if scanning -----
    if (window.__gemExporterInterval) {
        clearInterval(window.__gemExporterInterval);
    }
    window.__gemExporterInterval = setInterval(() => {
        if (window.__gemExporterDeepScanPromise) return; // skip dom sync if batchexecute is running
        tryExpandRecents();
        syncOnce();
    }, 2000);

    window.addEventListener('load', () => {
        ensureBadge();
        syncOnce();
        setTimeout(syncOnce, 2000);
        setTimeout(syncOnce, 5000);
    });

    window.addEventListener('popstate', () => {
        setTimeout(() => {
            refreshInitialBadge();
            syncOnce();
        }, 500);
    });

    if (document.readyState !== 'loading') {
        ensureBadge();
        setTimeout(syncOnce, 800);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            ensureBadge();
            syncOnce();
        }, {
            once: true
        });
    }

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'ping') {
            sendResponse({
                ok: true,
                ver: chrome.runtime.getManifest()?.version || '1.0.0',
                count: document.querySelectorAll('a[href*="/app/"]').length,
                deepRunning: !!window.__gemExporterDeepScanPromise
            });
            return true;
        }
        if (msg.action === 'getLinks') {
            const links = getConversationLinks();
            sendResponse({
                links,
                container: !!getScrollContainer(),
                linksCount: links.length
            });
            return true;
        }
        if (msg.action === 'resync') {
            syncOnce().then((r) => sendResponse({
                ok: true,
                ...r
            }));
            return true;
        }
        if (msg.action === 'deepScan' || msg.action === 'scrollToBottom') {
            if (window.__gemExporterDeepScanPromise) {
                sendResponse({
                    success: true,
                    pending: true,
                    message: 'already running'
                });
                return true;
            }
            const maxIter = msg.maxIter || 150;
            const mode = msg.mode || 'auto';
            scrollToBottomLoadAll(maxIter, mode).then(res => sendResponse(res)).catch(e => sendResponse({
                success: false,
                error: e.message
            }));
            return true;
        }
        if (msg.action === 'getScrollContainer') {
            const c = getScrollContainer();
            sendResponse({
                found: !!c,
                tag: c?.tagName || null,
                id: c?.id || null,
                class: c?.className?.slice(0, 120) || null
            });
            return true;
        }
        if (msg.action === 'getConversationDetail' || msg.action === 'fetchChat') {
            const cid = msg.conversationId || msg.id;
            if (!cid) {
                sendResponse({
                    success: false,
                    error: 'no id'
                });
                return true;
            }
            (async () => {
                try {
                    let clientCtor = (typeof GeminiAPIClient !== 'undefined') ? GeminiAPIClient : (window.GeminiAPIClient || null);
                    if (clientCtor && clientCtor.prototype.getConversationDetail) {
                        let client = new clientCtor();
                        let detail = await client.getConversationDetail(cid, msg.targetSid || null);
                        if (detail && detail.messages) {
                            sendResponse({
                                success: true,
                                data: detail,
                                source: 'batchexecute'
                            });
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('[Gemini Exporter] batchexecute detail fail, fallback to DOM', e.message);
                }
                try {
                    let chat = await contentFetchChatDetail(cid);
                    sendResponse({
                        success: true,
                        data: chat,
                        source: 'dom'
                    });
                } catch (e) {
                    sendResponse({
                        success: false,
                        error: e.message || String(e)
                    });
                }
            })();
            return true;
        }
        // --- Image/File blob handlers (merged from second listener) ---
        if (msg.action !== 'getImageBlob' && msg.action !== 'getFileBlob') return;
        if (msg.action === 'getFileBlob') {
            handleGetFileBlob(msg, sendResponse);
            return true;
        }
        handleGetImageBlob(msg, sendResponse);
        return true;
    });

    function cleanText(t) {
        return t ? t.replace(/\u00a0/g, ' ').replace(/\r/g, '').trim().slice(0, 20000) : '';
    }
    async function contentFetchChatDetail(id) {
        const url = `https://gemini.google.com/app/${id}`;
        const resp = await fetch(url, {
            credentials: 'include',
            headers: {
                'Accept': 'text/html'
            }
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const html = await resp.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return parseDoc(doc, id, url);
    }

    function parseDoc(doc, id, url) {
        let title = doc.title ? doc.title.replace(/ - Gemini.*$/i, '').trim() : '';
        if (!title || title === 'Gemini') {
            let h = doc.querySelector('title');
            if (h) title = h.textContent.trim().slice(0, 60);
        }
        if (!title) title = id;
        const messages = [];
        const nodes = doc.querySelectorAll('user-query, model-response');
        const sorted = [...nodes].sort((a, b) => {
            const pos = a.compareDocumentPosition(b);
            return (pos & 4) ? -1 : 1;
        });
        for (const node of sorted) {
            const isUser = node.tagName.toLowerCase() === 'user-query';
            let text = '';
            if (isUser) {
                const q = node.querySelector('.query-text-line, .query-text, [data-test-id="query-text"], p');
                if (q) text = (q.textContent || '').trim();
                if (!text) text = (node.textContent || '').trim();
                if (text) messages.push({
                    role: 'user',
                    content: cleanText(text)
                });
            } else {
                const md = node.querySelector('.markdown, message-content, [data-test-id="model-response-content"]') || node;
                let t = '';
                const parts = md.querySelectorAll('p, li, pre, code, h1,h2,h3, blockquote');
                if (parts.length) {
                    for (const p of parts) {
                        let tt = (p.textContent || '').trim();
                        if (!tt) continue;
                        if (tt.length > 5000) tt = tt.slice(0, 5000);
                        let tag = p.tagName.toLowerCase();
                        if (tag === 'li') t += `- ${tt}\n`;
                        else if (tag === 'pre') t += `\n\`\`\`\n${tt}\n\`\`\`\n\n`;
                        else t += tt + '\n\n';
                    }
                } else {
                    t = (md.textContent || '').trim();
                }
                t = t.replace(/\n{3,}/g, '\n\n').trim();
                if (t && t.length > 3) messages.push({
                    role: 'model',
                    content: cleanText(t)
                });
            }
        }
        const dedup = [];
        for (let i = 0; i < messages.length; i++) {
            if (i > 0 && messages[i].content === messages[i - 1].content && messages[i].role === messages[i - 1].role) continue;
            dedup.push(messages[i]);
        }
        if (!title || title === id) {
            let fu = dedup.find(m => m.role === 'user');
            if (fu) title = fu.content.slice(0, 50).replace(/\n/g, ' ');
        }
        return {
            id,
            title: title.slice(0, 120) || id,
            url,
            timestamp: new Date().toISOString(),
            messages: dedup,
            messageCount: dedup.length,
            attachmentCount: 0
        };
    }

    // --- File blob handler ---
    function handleGetFileBlob(msg, sendResponse) {
        (async () => {
            try {
                const toDataUrl = (blob) => new Promise((res, rej) => {
                    let fr = new FileReader();
                    fr.onloadend = () => res(String(fr.result || ""));
                    fr.onerror = () => rej(fr.error || new Error("read fail"));
                    fr.readAsDataURL(blob);
                });
                const extractGucUrl = (text) => {
                    let m = text.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*download[^\s"'<>]*/i);
                    if (m) return m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
                    let m2 = text.match(/https:\/\/lh3\.google(?:usercontent)?\.com\/[^\s"'<>\\]+/i);
                    return m2 ? m2[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&') : null;
                };
                let candidates = [];
                if (msg.candidates && Array.isArray(msg.candidates)) candidates.push(...msg.candidates);
                if (msg.url) candidates.unshift(msg.url);
                // DOM fallback for legacy
                try {
                    let links = document.querySelectorAll('a[href*="googleusercontent"], a[href*="drive.google"], a[download]');
                    for (let a of links) {
                        let href = a.href || a.getAttribute('href') || "";
                        let txt = (a.textContent || a.getAttribute('aria-label') || "").trim();
                        if (!href) continue;
                        if (msg.fileName && (txt.includes(msg.fileName) || href.includes(encodeURIComponent(msg.fileName)))) candidates.push(href);
                        else if (href.includes('googleusercontent') && href.includes('download')) candidates.push(href);
                    }
                } catch {}
                // html scan fallback
                try {
                    let html = document.documentElement.innerHTML || "";
                    let m = html.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*download[^\s"'<>]*/i);
                    if (m) candidates.push(m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'));
                } catch {}
                candidates = [...new Set(candidates.filter(Boolean))];
                if (!candidates.length) {
                    sendResponse({
                        success: false,
                        error: 'no file candidates (need Gemini page with login)'
                    });
                    return;
                }
                let seen = new Set();
                let queue = [...candidates];
                let reasons = [];
                while (queue.length) {
                    let u = queue.shift();
                    if (!u || seen.has(u)) continue;
                    seen.add(u);
                    try {
                        let resp = await fetch(u, {
                            credentials: 'include',
                            headers: {
                                'Accept': '*/*'
                            }
                        });
                        if (!resp.ok) {
                            reasons.push(`HTTP ${resp.status}`);
                            continue;
                        }
                        let ct = (resp.headers.get('content-type') || '').toLowerCase();
                        if (ct.startsWith('text/html')) {
                            let txt = await resp.text();
                            if (txt.includes('accounts.google.com') || txt.includes('Sign in') || txt.includes('登录')) {
                                reasons.push('login redirect');
                                continue;
                            }
                            if (txt.includes('This content isn') || txt.includes('not available') || txt.includes('Error 404') || txt.includes('Unable to load') || txt.includes('发生错误') || txt.includes('无法访问')) {
                                reasons.push('google error page');
                                continue;
                            }
                            let inner = extractGucUrl(txt);
                            if (inner && !seen.has(inner)) {
                                queue.push(inner);
                                continue;
                            }
                            if (txt.length < 5000) {
                                reasons.push('html<5k');
                                continue;
                            }
                            if (msg.fileName && /\.html?$/i.test(msg.fileName)) {
                                let blob = new Blob([txt], {
                                    type: 'text/html'
                                });
                                let dataUrl = await toDataUrl(blob);
                                sendResponse({
                                    success: true,
                                    blobBase64: dataUrl.split(',')[1],
                                    mime: 'text/html',
                                    size: blob.size,
                                    finalUrl: resp.url || u,
                                    contentType: 'text/html'
                                });
                                return;
                            }
                            reasons.push('html no file');
                            continue;
                        }
                        if (ct.startsWith('text/plain')) {
                            let txt = await resp.text();
                            let trimmed = txt.trim();
                            if (trimmed.startsWith('https://') && trimmed.length < 3000 && trimmed.includes('googleusercontent')) {
                                if (!seen.has(trimmed)) queue.push(trimmed);
                                continue;
                            }
                            if (trimmed.startsWith('http') && trimmed.length < 2000) continue;
                            let blob = new Blob([txt], {
                                type: ct || 'text/plain'
                            });
                            let dataUrl = await toDataUrl(blob);
                            sendResponse({
                                success: true,
                                blobBase64: dataUrl.split(',')[1],
                                mime: ct || 'text/plain',
                                size: blob.size,
                                finalUrl: resp.url || u,
                                contentType: ct
                            });
                            return;
                        }
                        let blob = await resp.blob();
                        if (blob.size < 10) {
                            reasons.push('blob<10');
                            continue;
                        }
                        if (blob.size < 400) {
                            try {
                                let txt = await blob.text();
                                if (txt.trim().startsWith('http')) {
                                    reasons.push('blob is redirect text');
                                    continue;
                                }
                            } catch {}
                        }
                        let dataUrl = await toDataUrl(blob);
                        sendResponse({
                            success: true,
                            blobBase64: dataUrl.split(',')[1],
                            mime: blob.type || ct,
                            size: blob.size,
                            finalUrl: resp.url || u,
                            contentType: ct || blob.type
                        });
                        return;
                    } catch (e) {
                        reasons.push('fetch exception');
                        continue;
                    }
                }
                sendResponse({
                    success: false,
                    error: 'all file candidates failed tried=' + seen.size + ' (' + reasons.slice(0, 3).join(', ') + ')',
                    tried: Array.from(seen).slice(0, 4)
                });
            } catch (e) {
                sendResponse({
                    success: false,
                    error: e.message
                });
            }
        })();
    }

    // --- Image blob handler ---
    function handleGetImageBlob(msg, sendResponse) {
        (async () => {
            try {
                const toHighRes = (url, variant = "s1024-rj") => {
                    try {
                        let [base, q = ""] = url.split("?");
                        let stripped = base.replace(/=s\d+(?:-[a-z0-9]+)*/i, "");
                        let suffix = q ? q + "&alr=yes" : "alr=yes";
                        return stripped + "=" + variant + "?" + suffix;
                    } catch {
                        return url;
                    }
                };
                const toDataUrl = (blob) => new Promise((res, rej) => {
                    let fr = new FileReader();
                    fr.onloadend = () => res(String(fr.result || ""));
                    fr.onerror = () => rej(fr.error || new Error("read fail"));
                    fr.readAsDataURL(blob);
                });
                const extractLh3 = (text) => {
                    let m = text.match(/https:\/\/lh3\.google(?:usercontent)?\.com\/[^\s"'<>\\]+/i);
                    return m ? m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&') : null;
                };
                let candidates = msg.candidates && Array.isArray(msg.candidates) ? msg.candidates.slice() : [toHighRes(msg.url), msg.url].filter(Boolean);
                let seen = new Set();
                let queue = [...candidates];
                while (queue.length) {
                    let u = queue.shift();
                    if (!u || seen.has(u)) continue;
                    seen.add(u);
                    try {
                        let r = await fetch(u, {
                            credentials: 'include',
                            headers: {
                                'Accept': 'image/*,*/*;q=0.8'
                            }
                        });
                        if (!r.ok) continue;
                        let ct = r.headers.get('content-type') || "";
                        if (ct.startsWith('image/')) {
                            let blob = await r.blob();
                            let dataUrl = await toDataUrl(blob);
                            sendResponse({
                                success: true,
                                blobBase64: dataUrl.split(',')[1],
                                mime: blob.type,
                                size: blob.size,
                                finalUrl: r.url || u,
                                contentType: ct
                            });
                            return;
                        }
                        if (ct.startsWith('text/plain') || ct.startsWith('text/html')) {
                            let txt = await r.text();
                            let inner = extractLh3(txt);
                            if (inner && !seen.has(inner)) queue.push(inner);
                            else if (txt.includes('googleusercontent')) {
                                let m2 = txt.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*/i);
                                if (m2 && !seen.has(m2[0])) queue.push(m2[0]);
                            }
                            continue;
                        }
                        let blob = await r.blob();
                        if (blob.size > 800) {
                            let dataUrl = await toDataUrl(blob);
                            sendResponse({
                                success: true,
                                blobBase64: dataUrl.split(',')[1],
                                mime: blob.type || ct,
                                size: blob.size,
                                finalUrl: r.url || u
                            });
                            return;
                        }
                    } catch (e) {
                        continue;
                    }
                }
                sendResponse({
                    success: false,
                    error: 'all candidates failed ' + seen.size + ' tried',
                    tried: Array.from(seen).slice(0, 4)
                });
            } catch (e) {
                sendResponse({
                    success: false,
                    error: e.message
                });
            }
        })();
    }

    console.log('[Gemini Exporter] ready');
})();