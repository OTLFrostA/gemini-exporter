// gemini_client.js - Gemini internal batchexecute API network and credentials client
(function(global) {
    'use strict';

    const GEMINI_API_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute";
    const RPCS = {
        LIST: "MaZiqc",
        DETAIL: "hNvQHb",
        GEMS: "CNgdBe"
    };
    const BL_FALLBACK = "boq_assistant-bard-web-server_20260802.09_p1";
    const generateFallbackSid = () => String(Math.floor(Math.random() * 1e19));

    // Get parser instance (from gemini_parser.js or fallback)
    function getParser() {
        if (typeof globalThis !== 'undefined' && globalThis.GeminiResponseParserClass) {
            return globalThis.GeminiResponseParserClass;
        }
        if (typeof global !== 'undefined' && global.GeminiResponseParserClass) {
            return global.GeminiResponseParserClass;
        }
        if (typeof require !== 'undefined') {
            try { return require('./geminiParser.js').GeminiResponseParserClass; } catch { /* intentional: require fallback in browser context */ }
            try { return require('./gemini_parser.js').GeminiResponseParserClass; } catch { /* intentional: require fallback in browser context */ }
        }
        throw new Error('GeminiResponseParserClass not found. Make sure gemini_parser.js is loaded.');
    }

    function getApiUrl(slot) {
        if (slot && slot !== "default") {
            let t = slot.replace(/^u/, "/u/");
            return `https://gemini.google.com${t}/_/BardChatUi/data/batchexecute`;
        }
        return GEMINI_API_URL;
    }

    // @contentScriptOnly — requires live page DOM, guarded for non-DOM environments
    function getBlFromPage() {
        if (typeof document === 'undefined') return null;
        try {
            let html = (global.document && global.document.documentElement && global.document.documentElement.innerHTML) || "";
            let m = html.match(/"cfb2h"\s*:\s*"([^"]+)"/) || html.match(/"bl"\s*:\s*"(boq_assistant[^"]+)"/);
            if (m) return m[1];
            if (global.__gemExporterBl) return global.__gemExporterBl;
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:geminiClient.js]", e); }
        return null;
    }

    // @contentScriptOnly — requires live page DOM, guarded for non-DOM environments
    function getAtFromPage() {
        if (typeof document === 'undefined') return null;
        try {
            if (global.__gemExporterExtractAt) {
                let a = global.__gemExporterExtractAt();
                if (a) return a;
            }
            if (global._WIZ_global_data && global._WIZ_global_data.SNlM0e) return global._WIZ_global_data.SNlM0e;
            if (global.WIZ_global_data && global.WIZ_global_data.SNlM0e) return global.WIZ_global_data.SNlM0e;
            let scripts = global.document ? global.document.querySelectorAll('script') : [];
            for (let s of scripts) {
                let txt = s.textContent || "";
                let m = txt.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
                if (m) return m[1];
            }
            let html = (global.document && global.document.documentElement && global.document.documentElement.innerHTML) || "";
            let mHtml = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
            if (mHtml) return mHtml[1];
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:geminiClient.js]", e); }
        return "";
    }

    // @contentScriptOnly — requires live page DOM, guarded for non-DOM environments
    function detectSlot() {
        if (typeof document === 'undefined') return null;
        try {
            let m = (global.location && global.location.pathname || "").match(/\/u\/(\d+)/);
            if (m) return `u${m[1]}`;
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:geminiClient.js]", e); }
        return "default";
    }

    async function loadCredMap() {
        try {
            let s = await chrome.storage.local.get(["gemini_credentials_map", "gemini_credentials"]);
            let map = s.gemini_credentials_map || {};
            if (s.gemini_credentials && s.gemini_credentials.sid && !map[s.gemini_credentials.sid]) {
                map[s.gemini_credentials.sid] = {
                    at: s.gemini_credentials.at || "",
                    sid: s.gemini_credentials.sid,
                    accountSlot: "default",
                    lastUsed: Date.now()
                };
            }
            return map;
        } catch {
            return {};
        }
    }

    async function resolveCred(targetSid, overrides) {
        let map = await loadCredMap();
        let vals = Object.values(map);
        let pageAt = getAtFromPage();
        let pageBl = getBlFromPage();
        if ((!vals.length || !vals[0].at) && pageAt) {
            let slot = detectSlot();
            let sid = vals[0]?.sid || ("page_" + Date.now());
            let entry = {
                sid,
                at: pageAt,
                bl: pageBl || BL_FALLBACK,
                accountSlot: slot,
                lastUsed: Date.now()
            };
            vals = [entry];
            try {
                await chrome.storage.local.set({
                    gemini_credentials_map: {
                        [sid]: entry
                    },
                    gemini_credentials: {
                        at: pageAt,
                        sid
                    }
                });
            } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:geminiClient.js]", e); }
        } else if (pageBl && vals[0] && !vals[0].bl) {
            vals[0].bl = pageBl;
        }
        const normSlot = s => (s === 'u0' || !s ? 'default' : s);
        let result;
        if (targetSid && map[targetSid]) {
            result = {
                ...map[targetSid],
                bl: map[targetSid].bl || pageBl || BL_FALLBACK,
                at: map[targetSid].at || pageAt || ""
            };
        } else {
            let cur = normSlot(detectSlot());
            let f = vals.filter(v => normSlot(v.accountSlot) === cur);
            let arr = f.length ? f : vals;
            arr.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
            if (arr[0]) {
                result = {
                    ...arr[0],
                    bl: arr[0].bl || pageBl || BL_FALLBACK,
                    at: arr[0].at || pageAt || ""
                };
            } else {
                result = {
                    sid: generateFallbackSid(),
                    at: pageAt || "",
                    accountSlot: "default",
                    bl: pageBl || BL_FALLBACK
                };
            }
        }
        if (overrides) {
            if (overrides.at) result.at = overrides.at;
            if (overrides.bl) result.bl = overrides.bl;
        }
        return result;
    }

    class GeminiAPIClient {
        constructor() {
            this.aborted = false;
        }
        abort() {
            this.aborted = true;
        }
        getApiUrl(s) {
            return getApiUrl(s);
        }
        async getConversationList(pageToken, targetSid, customFilter, opts) {
            let cred = await resolveCred(targetSid, opts && (opts._overrideAt || opts._overrideBl) ? { at: opts._overrideAt, bl: opts._overrideBl } : null);
            let api = getApiUrl(cred.accountSlot || "default");
            let params = new URLSearchParams({
                rpcids: RPCS.LIST,
                "source-path": "/app",
                bl: cred.bl || BL_FALLBACK,
                "f.sid": cred.sid || generateFallbackSid(),
                _reqid: Math.floor(1e5 * Math.random()).toString(),
                rt: "c"
            });
            let body = new URLSearchParams();
            const filter = customFilter || [0, null, 1];
            let req = pageToken ? JSON.stringify([
                    [
                        [RPCS.LIST, JSON.stringify([50, pageToken, filter]), null, "generic"]
                    ]
                ]) :
                JSON.stringify([
                    [
                        [RPCS.LIST, JSON.stringify([50, null, filter]), null, "generic"]
                    ]
                ]);
            body.append("f.req", req);
            if (cred.at) body.append("at", cred.at);
            let resp = await fetch(`${api}?${params}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: body.toString(),
                credentials: "include"
            });
            if (!resp.ok) {
                let snippet = "";
                try {
                    snippet = (await resp.text()).slice(0, 320);
                } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:geminiClient.js]", e); }
                if (resp.status === 400 && !opts?._retried) {
                    const mXsrf = snippet.includes('xsrf') ? snippet.match(/"xsrf"\s*,\s*"([^"]+)"/) : null;
                    const freshAt = (mXsrf && mXsrf[1]) ? mXsrf[1] : getAtFromPage();
                    const freshBl = getBlFromPage();
                    if ((freshAt && freshAt !== cred.at) || (freshBl && freshBl !== cred.bl)) {
                        try {
                            let map = await loadCredMap();
                            if (cred.sid && map[cred.sid]) {
                                if (freshAt) map[cred.sid].at = freshAt;
                                if (freshBl) map[cred.sid].bl = freshBl;
                                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                                    await chrome.storage.local.set({ gemini_credentials_map: map });
                                }
                            }
                        } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
                        return this.getConversationList(pageToken, targetSid, customFilter, {
                            ...(opts || {}),
                            _retried: true,
                            _overrideAt: freshAt || cred.at,
                            _overrideBl: freshBl || cred.bl
                        });
                    }
                }
                const retryCount = (opts && opts._retryCount) || 0;
                const maxRetries = (opts && opts.maxRetries) !== undefined ? opts.maxRetries : 3;
                if (resp.status === 429 && retryCount < maxRetries) {
                    const retryAfter = resp.headers?.get ? resp.headers.get('retry-after') : null;
                    let delayMs = Math.min(30000, 2000 * Math.pow(2, retryCount) + Math.floor(Math.random() * 1000));
                    if (retryAfter) {
                        const s = parseInt(retryAfter, 10);
                        if (!isNaN(s) && s > 0) delayMs = Math.max(delayMs, s * 1000);
                    }
                    console.warn(`[Gemini Exporter Client] getConversationList 429 rate limited, backoff ${delayMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(r => setTimeout(r, delayMs));
                    return this.getConversationList(pageToken, targetSid, customFilter, {
                        ...(opts || {}),
                        _retryCount: retryCount + 1
                    });
                }
                throw new Error(`HTTP ${resp.status} :: ${snippet} sid:${cred.sid?.slice(0,6)} atLen:${cred.at?.length} bl:${cred.bl?.slice(0,12)}`);
            }
            let txt = await resp.text();
            return getParser().parseList(txt);
        }
        async getAllConversations(maxPages = 2000, onProgress, targetSid, opts) {
            if (!maxPages || typeof maxPages !== "number") maxPages = 2000;
            opts = opts || {};
            const existingMap = opts.existingMap || null;
            const incremental = !!opts.incremental;
            const unchangedThreshold = opts.unchangedThreshold || 5;
            let all = [],
                seen = new Set(),
                token = null;
            let unchangedStreak = 0;
            const diagLog = {
                startTime: new Date().toISOString(),
                maxPages,
                incremental,
                totalPagesFetched: 0,
                totalConversations: 0,
                stopReason: '就绪（尚未触发同步）',
                hitGoogleLimit: false,
                pageHistory: []
            };
            this.aborted = false;
            // 兼容 content.js 的 window 全局中止标志（旧链路仅置 window 标志，未调 client.abort）
            const isAborted = () => this.aborted || (typeof window !== 'undefined' && window.__gemExporterAborted) || (typeof globalThis !== 'undefined' && globalThis.__gemExporterAborted);
            let reachedMax = true;
            for (let i = 0; i < maxPages; i++) {
                if (isAborted()) {
                    diagLog.stopReason = `用户手动终止同步 (已拉取 ${i} 页，共 ${all.length} 条)`;
                    console.log(`[Gemini Exporter] getAllConversations aborted by user at page ${i + 1}`);
                    reachedMax = false;
                    break;
                }
                let res;
                try {
                    res = await this.getConversationList(token, targetSid);
                } catch (err) {
                    console.warn(`[Gemini Exporter] getAllConversations page ${i + 1} stopped:`, err.message || err);
                    const errMsg = String(err?.message || err);
                    const isLimit = errMsg.includes('BardErrorInfo')
                        || errMsg.includes('1096')
                        || errMsg.includes('429')
                        || /quota|rate\s*limit|resource_exhausted|too\s*many\s*requests/i.test(errMsg)
                        || (!incremental && all.length >= 300);
                    if (isLimit) {
                        diagLog.hitGoogleLimit = true;
                    }
                    diagLog.stopReason = `网络或服务异常: ${err.message || err}`;
                    reachedMax = false;
                    if (all.length > 0) {
                        break;
                    }
                    throw err;
                }
                diagLog.totalPagesFetched = i + 1;
                diagLog.pageHistory.push({
                    page: i + 1,
                    requestedToken: token ? { len: token.length, preview: token.slice(0, 20) + '...' } : null,
                    count: res?.conversations?.length || 0,
                    hasNextPageToken: !!res?.nextPageToken,
                    nextTokenPreview: res?.nextPageToken ? { len: res.nextPageToken.length, preview: res.nextPageToken.slice(0, 20) + '...' } : null,
                    debugInfo: res?._debug || null
                });
                let added = 0;
                for (let c of res.conversations) {
                    if (!seen.has(c.id)) {
                        seen.add(c.id);
                        all.push(c);
                        added++;
                        if (incremental && existingMap) {
                            const stored = existingMap.get(c.id);
                            if (stored && stored.timestamp && c.timestamp) {
                                const sameTime = Math.abs(stored.timestamp - c.timestamp) < 60000;
                                const sameTitle = !stored.title || !c.title || stored.title === c.title;
                                if (sameTime && sameTitle) {
                                    unchangedStreak++;
                                } else {
                                    unchangedStreak = 0;
                                }
                            } else if (!stored) {
                                unchangedStreak = 0;
                            } else {
                                unchangedStreak = 0;
                            }
                            if (unchangedStreak >= unchangedThreshold) {
                                diagLog.stopReason = `增量同步命中连续 ${unchangedStreak} 条已存在历史，早退终止`;
                                diagLog.totalConversations = all.length;
                                diagLog.endTime = new Date().toISOString();
                                if (onProgress) onProgress({
                                    page: i + 1,
                                    added,
                                    total: all.length,
                                    hasMore: false,
                                    stoppedEarly: true,
                                    reason: '增量同步完成'
                                });
                                return {
                                    conversations: all,
                                    total: all.length,
                                    stoppedEarly: true,
                                    unchangedStreak,
                                    diagnostics: diagLog,
                                    hitGoogleLimit: !!diagLog.hitGoogleLimit
                                };
                            }
                        }
                    }
                }
                if (!res.conversations || res.conversations.length === 0) {
                    const isGoogleLimit = res?._debug?.bardError || res?._debug?.error === 'BARD_ERROR_INFO' || (!incremental && all.length >= 500);
                    if (isGoogleLimit) {
                        diagLog.hitGoogleLimit = true;
                        diagLog.stopReason = res?._debug?.bardError ? `Google 服务端翻页到达极限 (BardErrorInfo: 游标链已达服务端上限)` : `Google 服务端游标链到达上限 (~600条限制，共 ${all.length} 条)`;
                    } else {
                        diagLog.stopReason = `第 ${i + 1} 页返回 0 条数据，Google 服务端已无更早历史`;
                    }
                    reachedMax = false;
                    console.log(`[Gemini Exporter] getAllConversations reached end at page ${i + 1}, total: ${all.length}, reason: ${diagLog.stopReason}`);
                    break;
                }
                if (onProgress) onProgress({
                    page: i + 1,
                    added,
                    total: all.length,
                    hasMore: !!res.nextPageToken,
                    batch: res.conversations
                });
                if (!res.nextPageToken) {
                    if (!incremental && all.length >= 500) {
                        diagLog.hitGoogleLimit = true;
                        diagLog.stopReason = `Google 服务端游标链已到底 (~600条上限截断，共 ${all.length} 条)`;
                    } else {
                        diagLog.stopReason = `第 ${i + 1} 页未返回下页游标 nextPageToken，Google 服务端游标已到底`;
                    }
                    reachedMax = false;
                    console.log(`[Gemini Exporter] getAllConversations finished at page ${i + 1}, total: ${all.length}, hitGoogleLimit: ${diagLog.hitGoogleLimit}`);
                    break;
                }
                token = res.nextPageToken;
                const pageDelay = incremental ? 50 : 120;
                await new Promise(r => setTimeout(r, pageDelay));
            }
            if (reachedMax && maxPages > 0) {
                diagLog.stopReason = `已达到最大页数限制 (${maxPages} 页)`;
            }
            if (!incremental && all.length >= 500) {
                diagLog.hitGoogleLimit = true;
            }
            diagLog.totalConversations = all.length;
            diagLog.endTime = new Date().toISOString();
            return {
                conversations: all,
                total: all.length,
                diagnostics: diagLog,
                hitGoogleLimit: !!diagLog.hitGoogleLimit
            };
        }
        async fetchConversationPage(conversationId, pageToken, targetSid, opts) {
            let id = conversationId.startsWith("c_") ? conversationId : `c_${conversationId}`;
            let cred = await resolveCred(targetSid, opts && (opts._overrideAt || opts._overrideBl) ? { at: opts._overrideAt, bl: opts._overrideBl } : null);
            let api = getApiUrl(cred.accountSlot || "default");
            const isDevMode = (typeof globalThis !== 'undefined' && globalThis.__gemExporterDevMode)
                || (typeof window !== 'undefined' && window.__gemExporterDevMode);
            if (isDevMode) {
                console.log(`[Gemini Exporter Client] fetchConversationPage start: ${id}, api: ${api}, slot: ${cred.accountSlot}, hasAt: ${Boolean(cred.at)}, atLen: ${(cred.at || '').length}`);
            }
            const detailOnly = !!(opts && opts.detailOnly);
            let params = new URLSearchParams({
                rpcids: detailOnly ? RPCS.DETAIL : `${RPCS.DETAIL},${RPCS.LIST}`,
                "source-path": "/app",
                bl: cred.bl || BL_FALLBACK,
                "f.sid": cred.sid || generateFallbackSid(),
                _reqid: Math.floor(1e5 * Math.random()).toString(),
                rt: "c"
            });
            let body = new URLSearchParams();
            // opts.altParams: use alternative innerDetail format for metadata-only retry
            let innerDetail = (opts && opts.altParams)
                ? JSON.stringify([id, null, pageToken || null, 1, [1], [4], null, 1])
                : JSON.stringify([id, 10, pageToken || null, 1, [1], [4], null, 1]);
            let innerMeta = JSON.stringify([1, null, [null, null, 1, null, 1, id]]);
            let fReq = detailOnly
                ? JSON.stringify([[[RPCS.DETAIL, innerDetail, null, "generic"]]])
                : JSON.stringify([[[RPCS.DETAIL, innerDetail, null, "generic"], [RPCS.LIST, innerMeta, null, "generic"]]]);
            body.append("f.req", fReq);
            if (cred.at) body.append("at", cred.at);
            let controller = null;
            let timeoutId = null;
            if (typeof AbortController !== 'undefined') {
                controller = new AbortController();
                timeoutId = setTimeout(() => {
                    try { controller.abort(); } catch { /* intentional: best-effort cleanup */ }
                }, 15000);
            }
            let resp;
            try {
                resp = await fetch(`${api}?${params}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                        "X-Same-Domain": "1"
                    },
                    body: body.toString(),
                    credentials: "include",
                    signal: controller ? controller.signal : undefined
                });
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }
            if (!resp.ok) {
                let snippet = "";
                try {
                    snippet = (await resp.text()).slice(0, 320);
                } catch { /* intentional: best-effort cleanup */ }
                if (resp.status === 400 && !opts?._retriedXsrf) {
                    const mXsrf = snippet.includes('xsrf') ? snippet.match(/"xsrf"\s*,\s*"([^"]+)"/) : null;
                    const freshAt = (mXsrf && mXsrf[1]) ? mXsrf[1] : getAtFromPage();
                    const freshBl = getBlFromPage();
                    if ((freshAt && freshAt !== cred.at) || (freshBl && freshBl !== cred.bl)) {
                        try {
                            let map = await loadCredMap();
                            if (cred.sid && map[cred.sid]) {
                                if (freshAt) map[cred.sid].at = freshAt;
                                if (freshBl) map[cred.sid].bl = freshBl;
                                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                                    await chrome.storage.local.set({ gemini_credentials_map: map });
                                }
                            }
                        } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
                        return this.fetchConversationPage(conversationId, pageToken, targetSid, {
                            ...(opts || {}),
                            _retriedXsrf: true,
                            _overrideAt: freshAt || cred.at,
                            _overrideBl: freshBl || cred.bl
                        });
                    }
                }
                const retryCount = (opts && opts._retryCount) || 0;
                const maxRetries = (opts && opts.maxRetries) !== undefined ? opts.maxRetries : 3;
                if (resp.status === 429 && retryCount < maxRetries) {
                    const retryAfter = resp.headers?.get ? resp.headers.get('retry-after') : null;
                    let delayMs = Math.min(30000, 2000 * Math.pow(2, retryCount) + Math.floor(Math.random() * 1000));
                    if (retryAfter) {
                        const s = parseInt(retryAfter, 10);
                        if (!isNaN(s) && s > 0) delayMs = Math.max(delayMs, s * 1000);
                    }
                    console.warn(`[Gemini Exporter Client] fetchConversationPage 429 rate limited for ${id}, backoff ${delayMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
                    await new Promise(r => setTimeout(r, delayMs));
                    return this.fetchConversationPage(conversationId, pageToken, targetSid, {
                        ...(opts || {}),
                        _retryCount: retryCount + 1
                    });
                }
                console.error(`[Gemini Exporter Client] fetchConversationPage HTTP error ${resp.status} for ${id}:`, snippet);
                throw new Error(`HTTP ${resp.status} ${resp.statusText} :: ${snippet}`);
            }
            let text = await resp.text();
            try {
                let parsed = getParser().parseDetail(text, conversationId);
                if (isDevMode) {
                    console.log(`[Gemini Exporter Client] fetchConversationPage parsed success: ${id}, msgs: ${parsed.messages?.length}`);
                }
                return parsed;
            } catch (err) {
                const isDeletedOrInaccessible = text && (text.includes('BardErrorInfo') || text.includes('1167'));
                if (isDeletedOrInaccessible) {
                    if (isDevMode) {
                        console.info(`[Gemini Exporter Client] Conversation ${id} is inaccessible or deleted on server (BardErrorInfo: 1167). Skipping.`);
                    }
                    throw new Error(`会话已在服务端删除或不可访问 (${id})`);
                }
                console.error(`[Gemini Exporter Client] parseDetail failed for ${id}:`, err.message, 'raw text snippet:', text.slice(0, 400));
                throw new Error(`解析详情失败 (${err.message}): ${text.slice(0, 100)}`);
            }
        }
        async getConversationDetail(conversationId, targetSid) {
            let msgs = [];
            let token = null;
            let first = null;
            let attempts = 0;
            do {
                let page = await this.fetchConversationPage(conversationId, token, targetSid);
                if (!first) first = page;
                msgs = [...page.messages, ...msgs];
                token = page.nextPageToken || null;
                attempts++;
            } while (token && attempts < 20);
            if (!first) throw new Error("no data");
            
            // If the primary request returned metadata-only (no messages, but raw data present),
            // do one retry with DETAIL-only RPC and alternative innerDetail params.
            if (!msgs.length && first._raw) {
                const inner = first._raw;
                const looksMetadataOnly = Array.isArray(inner) && inner[0] === null && inner[1] === null
                    && Array.isArray(inner[2]) && inner[2].length > 0
                    && typeof inner[2][0]?.[0] === 'string' && inner[2][0][0].startsWith('c_');
                if (looksMetadataOnly) {
                    try {
                        const retry = await this.fetchConversationPage(conversationId, null, targetSid, { detailOnly: true, altParams: true });
                        if (retry && retry.messages && retry.messages.length > 0) {
                            const primaryTitle = first.title;
                            const primaryTitles = first.titles;
                            const primarySource = first.titleSource;
                            msgs = retry.messages;
                            first = retry;
                            if (primarySource === 'rpc' && primaryTitle && primaryTitle !== '未命名对话' && first.titleSource !== 'rpc') {
                                first.title = primaryTitle;
                                first.titles = { ...(first.titles || {}), ...(primaryTitles || {}) };
                                first.titleSource = 'rpc';
                            }
                        }
                    } catch (retryErr) {
                        const isDevMode = (typeof globalThis !== 'undefined' && globalThis.__gemExporterDevMode)
                            || (typeof window !== 'undefined' && window.__gemExporterDevMode);
                        if (isDevMode) {
                            console.warn('[Gemini Exporter Client] metadata-only retry also failed:', retryErr.message);
                        }
                    }
                }
            }

            let allTimestamps = msgs.map(m => m.timestamp).filter(x => typeof x === 'number' && Number.isFinite(x) && x > 0);
            let minTs = allTimestamps.length ? Math.min(...allTimestamps) : (first.createdAt || null);
            let maxTs = allTimestamps.length ? Math.max(...allTimestamps) : (first.updatedAt || minTs || null);
            let attachmentCount = msgs.reduce((a, m) => a + (m.attachmentCount || 0), 0);
            let cleanId = String(conversationId).replace(/^c_/, '').trim();
            return {
                ...first,
                id: cleanId,
                messages: msgs,
                messageCount: msgs.length,
                timestamp: maxTs,
                createdAt: minTs,
                chatTime: maxTs,
                updatedAt: maxTs,
                attachmentCount
            };
        }
        // @contentScriptOnly — requires live page DOM, guarded for non-DOM environments
        getCurrentConversationId() {
            if (typeof document === 'undefined') return null;
            try {
                let u = new URL(global.location.href);
                let parts = u.pathname.split('/');
                let idx = parts.indexOf('app');
                if (idx !== -1 && idx < parts.length - 1) return parts[idx + 1];
                let g = parts.indexOf('gem');
                if (g !== -1 && g < parts.length - 2) return parts[g + 2];
                return null;
            } catch {
                return null;
            }
        }
    }

    global.GeminiAPIClient = GeminiAPIClient;
    global.getApiUrl = getApiUrl;
    global.detectSlot = detectSlot;
    global.resolveCred = resolveCred;
    global.loadCredMap = loadCredMap;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            GeminiAPIClient,
            getApiUrl,
            detectSlot,
            resolveCred,
            loadCredMap
        };
    }

})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this)));
