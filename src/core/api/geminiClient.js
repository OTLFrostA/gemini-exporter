// geminiClient.js - Gemini internal batchexecute API network and credentials client
(function(global) {
    'use strict';

    function resolveModule(globalName, relPath) {
        if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
        if (typeof global !== 'undefined' && global[globalName]) return global[globalName];
        if (typeof self !== 'undefined' && self[globalName]) return self[globalName];
        if (typeof require !== 'undefined') {
            try { return require(relPath); } catch (_) {}
        }
        return null;
    }

    const credentialManager = resolveModule('GeminiClientCredentialManager', './client/credentialManager.js') || {};
    const retryPolicy = resolveModule('GeminiClientRetryPolicy', './client/retryPolicy.js') || {};
    const rpcClient = resolveModule('GeminiClientRpcClient', './client/rpcClient.js') || {};
    const pagination = resolveModule('GeminiClientPagination', './client/pagination.js') || {};

    const getProtocol = () => {
        if (rpcClient.getProtocol) return rpcClient.getProtocol();
        if (typeof globalThis !== 'undefined' && globalThis.GeminiProtocol) return globalThis.GeminiProtocol;
        if (typeof require !== 'undefined') {
            try { return require('../protocol/protocol.js'); } catch (_) {}
        }
        throw new Error('GeminiProtocol not found. Make sure core/protocol/protocol.js is loaded.');
    };

    const getUtils = () => {
        if (rpcClient.getUtils) return rpcClient.getUtils();
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils) return globalThis.GeminiUtils;
        if (typeof require !== 'undefined') {
            try { return require('../utils/utils.js'); } catch (_) {}
        }
        return null;
    };

    const getParser = () => {
        if (rpcClient.getParser) return rpcClient.getParser();
        if (typeof globalThis !== 'undefined' && globalThis.GeminiResponseParserClass) return globalThis.GeminiResponseParserClass;
        if (typeof global !== 'undefined' && global.GeminiResponseParserClass) return global.GeminiResponseParserClass;
        if (typeof require !== 'undefined') {
            try { return require('./geminiParser.js').GeminiResponseParserClass; } catch (_) {}
        }
        throw new Error('GeminiResponseParserClass not found. Make sure geminiParser.js is loaded.');
    };

    const postBatchexecute = rpcClient.postBatchexecute || (async () => { throw new Error('rpcClient not found'); });

    function getApiUrl(slot) {
        if (rpcClient.getApiUrl) return rpcClient.getApiUrl(slot);
        if (slot && slot !== "default") {
            let t = slot.replace(/^u/, "/u/");
            return `https://gemini.google.com${t}/_/BardChatUi/data/batchexecute`;
        }
        return "https://gemini.google.com/_/BardChatUi/data/batchexecute";
    }

    function getBlFromPage() {
        return credentialManager.getBlFromPage ? credentialManager.getBlFromPage() : null;
    }

    function getAtFromPage() {
        return credentialManager.getAtFromPage ? credentialManager.getAtFromPage() : "";
    }

    function detectSlot() {
        return credentialManager.detectSlot ? credentialManager.detectSlot() : "default";
    }

    async function loadCredMap() {
        return credentialManager.loadCredMap ? credentialManager.loadCredMap() : {};
    }

    async function resolveCred(targetSid, overrides) {
        if (credentialManager.resolveCred) {
            return credentialManager.resolveCred(targetSid, overrides);
        }
        return { sid: "default", at: "", bl: "", accountSlot: "default" };
    }

    class GeminiAPIClient {
        constructor() {
            this.aborted = false;
        }
        abort() {
            this.aborted = true;
        }
        // 兼容 content.js 的 window 全局中止标志（旧链路仅置 window 标志，未调 client.abort）
        isAborted() {
            return this.aborted || (typeof window !== 'undefined' && window.__gemExporterAborted) || (typeof globalThis !== 'undefined' && globalThis.__gemExporterAborted);
        }
        getApiUrl(s) {
            return getApiUrl(s);
        }
        async getConversationList(pageToken, targetSid, customFilter, opts) {
            let cred = await resolveCred(targetSid, opts && (opts._overrideAt || opts._overrideBl) ? { at: opts._overrideAt, bl: opts._overrideBl } : null);
            let api = getApiUrl(cred.accountSlot || "default");
            const filter = customFilter || [0, null, 1];
            const P = getProtocol();
            let req = pageToken ? JSON.stringify([
                    [
                        [P.RPCS.LIST, JSON.stringify([50, pageToken, filter]), null, "generic"]
                    ]
                ]) :
                JSON.stringify([
                    [
                        [P.RPCS.LIST, JSON.stringify([50, null, filter]), null, "generic"]
                    ]
                ]);

            let resp = await postBatchexecute({
                api,
                rpcids: P.RPCS.LIST,
                fReq: req,
                cred,
                sourcePath: "/app"
            });

            if (!resp.ok) {
                let snippet = "";
                try {
                    snippet = (await resp.text()).slice(0, 320);
                } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:geminiClient.js]", e); }

                // 400 Bad Request XSRF token retry
                const retry400 = retryPolicy.handleHttp400 ? await retryPolicy.handleHttp400({
                    resp,
                    snippet,
                    cred,
                    isRetried: !!opts?._retried,
                    getAtFromPage,
                    getBlFromPage,
                    loadCredMap,
                    getCredStorage: credentialManager.getCredStorage
                }) : { shouldRetry: false };

                if (retry400.shouldRetry) {
                    return this.getConversationList(pageToken, targetSid, customFilter, {
                        ...(opts || {}),
                        _retried: true,
                        _overrideAt: retry400.freshAt,
                        _overrideBl: retry400.freshBl
                    });
                }

                // 401 Unauthorized cleanup
                if (resp.status === 401 && retryPolicy.handleHttp401) {
                    await retryPolicy.handleHttp401({
                        cred,
                        loadCredMap,
                        getCredStorage: credentialManager.getCredStorage
                    });
                }

                // 429 Rate limiting backoff
                const retryCount = (opts && opts._retryCount) || 0;
                const maxRetries = (opts && opts.maxRetries) !== undefined ? opts.maxRetries : 3;
                const retry429 = retryPolicy.handleHttp429 ? await retryPolicy.handleHttp429({
                    resp,
                    retryCount,
                    maxRetries,
                    label: 'getConversationList'
                }) : { shouldRetry: false };

                if (retry429.shouldRetry) {
                    return this.getConversationList(pageToken, targetSid, customFilter, {
                        ...(opts || {}),
                        _retryCount: retry429.nextRetryCount
                    });
                }

                throw new Error(`HTTP ${resp.status} :: ${snippet} sid:${cred.sid?.slice(0,6)} atLen:${cred.at?.length} bl:${cred.bl?.slice(0,12)}`);
            }
            let txt = await resp.text();
            return getParser().parseList(txt);
        }

        // Note: If all.length >= 500 or pagination flags hitGoogleLimit / 429 errors,
        // UI layer provides browsing window limit guidance to recommend Takeout.
        async getAllConversations(maxPages = 2000, onProgress, targetSid, opts) {
            if (pagination.getAllConversations) {
                return pagination.getAllConversations(this, maxPages, onProgress, targetSid, opts);
            }
            throw new Error('pagination module not found');
        }

        async fetchConversationPage(conversationId, pageToken, targetSid, opts) {
            let id = conversationId.startsWith("c_") ? conversationId : `c_${conversationId}`;
            let cred = await resolveCred(targetSid, opts && (opts._overrideAt || opts._overrideBl) ? { at: opts._overrideAt, bl: opts._overrideBl } : null);
            let api = getApiUrl(cred.accountSlot || "default");
            const isDevMode = !!(getUtils()?.isDevMode ? getUtils().isDevMode() : false);
            if (isDevMode) {
                console.log(`[Gemini Exporter Client] fetchConversationPage start: ${id}, api: ${api}, slot: ${cred.accountSlot}, hasAt: ${Boolean(cred.at)}, atLen: ${(cred.at || '').length}`);
            }
            const detailOnly = !!(opts && opts.detailOnly);
            const P = getProtocol();
            const rpcids = detailOnly ? P.RPCS.DETAIL : `${P.RPCS.DETAIL},${P.RPCS.LIST}`;

            let innerDetail = (opts && opts.altParams)
                ? JSON.stringify([id, null, pageToken || null, 1, [1], [4], null, 1])
                : JSON.stringify([id, 10, pageToken || null, 1, [1], [4], null, 1]);
            let innerMeta = JSON.stringify([1, null, [null, null, 1, null, 1, id]]);
            let fReq = detailOnly
                ? JSON.stringify([[[P.RPCS.DETAIL, innerDetail, null, "generic"]]])
                : JSON.stringify([[[P.RPCS.DETAIL, innerDetail, null, "generic"], [P.RPCS.LIST, innerMeta, null, "generic"]]]);

            let resp = await postBatchexecute({
                api,
                rpcids,
                fReq,
                cred,
                sourcePath: "/app",
                timeoutMs: 15000
            });

            if (!resp.ok) {
                let snippet = "";
                try {
                    snippet = (await resp.text()).slice(0, 320);
                } catch { /* intentional: best-effort cleanup */ }

                // 400 Bad Request XSRF token retry
                const retry400 = retryPolicy.handleHttp400 ? await retryPolicy.handleHttp400({
                    resp,
                    snippet,
                    cred,
                    isRetried: !!opts?._retriedXsrf,
                    getAtFromPage,
                    getBlFromPage,
                    loadCredMap,
                    getCredStorage: credentialManager.getCredStorage
                }) : { shouldRetry: false };

                if (retry400.shouldRetry) {
                    return this.fetchConversationPage(conversationId, pageToken, targetSid, {
                        ...(opts || {}),
                        _retriedXsrf: true,
                        _overrideAt: retry400.freshAt,
                        _overrideBl: retry400.freshBl
                    });
                }

                // 401 Unauthorized cleanup
                if (resp.status === 401 && retryPolicy.handleHttp401) {
                    await retryPolicy.handleHttp401({
                        cred,
                        loadCredMap,
                        getCredStorage: credentialManager.getCredStorage
                    });
                }

                // 429 Rate limiting backoff
                const retryCount = (opts && opts._retryCount) || 0;
                const maxRetries = (opts && opts.maxRetries) !== undefined ? opts.maxRetries : 3;
                const retry429 = retryPolicy.handleHttp429 ? await retryPolicy.handleHttp429({
                    resp,
                    retryCount,
                    maxRetries,
                    label: `fetchConversationPage ${id}`
                }) : { shouldRetry: false };
                if (retry429.shouldRetry) {
                    return this.fetchConversationPage(conversationId, pageToken, targetSid, {
                        ...(opts || {}),
                        _retryCount: retry429.nextRetryCount
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
            if (pagination.getConversationDetail) {
                return pagination.getConversationDetail(this, conversationId, targetSid);
            }
            throw new Error('pagination module not found');
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
            loadCredMap,
            credentialManager,
            retryPolicy,
            rpcClient,
            pagination
        };
    }
})(typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this)));
