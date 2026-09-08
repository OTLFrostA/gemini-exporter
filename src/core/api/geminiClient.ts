// geminiClient.ts - Gemini internal batchexecute API network and credentials client
import type { GeminiProtocolModule } from "../protocol/protocol.js";
import type { GeminiClientCredentialManagerModule, GeminiCredentials } from "./client/credentialManager.js";
import type { GeminiClientRetryPolicyModule } from "./client/retryPolicy.js";
import type { GeminiClientRpcClientModule } from "./client/rpcClient.js";
import type { GeminiClientPaginationModule, PaginationOptions, PaginationResult } from "./client/pagination.js";
import type { ListParseResult } from "./parser/parseList.js";
import type { DetailParseResult } from "./parser/parseDetail.js";

export interface GeminiAPIClientOptions {
    signal?: AbortSignal | null;
    [key: string]: any;
}

(function(global: any) {
    "use strict";

    function resolveModule(globalName: string, relPath: string): any {
        if (typeof globalThis !== "undefined" && (globalThis as any)[globalName]) return (globalThis as any)[globalName];
        if (typeof global !== "undefined" && global[globalName]) return global[globalName];
        if (typeof self !== "undefined" && (self as any)[globalName]) return (self as any)[globalName];
        if (typeof require !== "undefined") {
            try { return require(relPath); } catch (_) {}
        }
        return null;
    }

    const credentialManager: GeminiClientCredentialManagerModule = resolveModule("GeminiClientCredentialManager", "./client/credentialManager.js") || {};
    const retryPolicy: GeminiClientRetryPolicyModule = resolveModule("GeminiClientRetryPolicy", "./client/retryPolicy.js") || {};
    const rpcClient: GeminiClientRpcClientModule = resolveModule("GeminiClientRpcClient", "./client/rpcClient.js") || {};
    const pagination: GeminiClientPaginationModule = resolveModule("GeminiClientPagination", "./client/pagination.js") || {};

    const getProtocol = (): GeminiProtocolModule => {
        if (rpcClient.getProtocol) return rpcClient.getProtocol();
        if (typeof globalThis !== "undefined" && (globalThis as any).GeminiProtocol) return (globalThis as any).GeminiProtocol;
        if (typeof require !== "undefined") {
            try { return require("../protocol/protocol.js"); } catch (_) {}
        }
        throw new Error("GeminiProtocol not found. Make sure core/protocol/protocol.js is loaded.");
    };

    const getUtils = (): any => {
        if (rpcClient.getUtils) return rpcClient.getUtils();
        if (typeof globalThis !== "undefined" && (globalThis as any).GeminiUtils) return (globalThis as any).GeminiUtils;
        if (typeof require !== "undefined") {
            try { return require("../utils/utils.js"); } catch (_) {}
        }
        return null;
    };

    const getParser = (): any => {
        if (rpcClient.getParser) return rpcClient.getParser();
        if (typeof globalThis !== "undefined" && (globalThis as any).GeminiResponseParserClass) return (globalThis as any).GeminiResponseParserClass;
        if (typeof global !== "undefined" && global.GeminiResponseParserClass) return global.GeminiResponseParserClass;
        if (typeof require !== "undefined") {
            try { return require("./geminiParser.js").GeminiResponseParserClass; } catch (_) {}
        }
        throw new Error("GeminiResponseParserClass not found. Make sure geminiParser.js is loaded.");
    };

    const postBatchexecute = rpcClient.postBatchexecute || (async () => { throw new Error("rpcClient not found"); });

    function getApiUrl(slot?: string | null): string {
        if (rpcClient.getApiUrl) return rpcClient.getApiUrl(slot);
        if (slot && slot !== "default") {
            let t = slot.startsWith("/") ? slot : (slot.startsWith("u/") ? `/${slot}` : slot.replace(/^u/, "/u/"));
            return `https://gemini.google.com${t}/_/BardChatUi/data/batchexecute`;
        }
        return "https://gemini.google.com/_/BardChatUi/data/batchexecute";
    }

    function getBlFromPage(): string | null {
        return credentialManager.getBlFromPage ? credentialManager.getBlFromPage() : null;
    }

    function getAtFromPage(): string {
        return credentialManager.getAtFromPage ? credentialManager.getAtFromPage() : "";
    }

    function detectSlot(): string | null {
        return credentialManager.detectSlot ? credentialManager.detectSlot() : "default";
    }

    async function loadCredMap(): Promise<any> {
        return credentialManager.loadCredMap ? credentialManager.loadCredMap() : {};
    }

    async function resolveCred(targetSid?: string | null, overrides?: any): Promise<GeminiCredentials> {
        if (credentialManager.resolveCred) {
            return credentialManager.resolveCred(targetSid, overrides);
        }
        return { sid: "default", at: "", bl: "", accountSlot: "default" };
    }

    class GeminiAPIClient {
        public aborted: boolean;
        public signal: AbortSignal | null;

        constructor(options: GeminiAPIClientOptions = {}) {
            this.aborted = false;
            this.signal = options?.signal || null;
            if (this.signal) {
                if (this.signal.aborted) {
                    this.aborted = true;
                } else if (typeof this.signal.addEventListener === "function") {
                    this.signal.addEventListener("abort", () => {
                        this.aborted = true;
                    }, { once: true });
                }
            }
        }

        abort(): void {
            this.aborted = true;
        }

        // 兼容标准 AbortSignal 及过渡期全局标志（仅作 fallback）
        isAborted(callSignal?: AbortSignal | null): boolean {
            if (this.aborted) return true;
            if (callSignal && callSignal.aborted) return true;
            if (this.signal && this.signal.aborted) return true;
            return !!(
                (typeof window !== "undefined" && (window as any).__gemExporterAborted) ||
                (typeof globalThis !== "undefined" && (globalThis as any).__gemExporterAborted)
            );
        }

        getApiUrl(s?: string | null): string {
            return getApiUrl(s);
        }

        async getConversationList(pageToken?: string | null, targetSid?: string | null, customFilter?: any, opts?: any): Promise<ListParseResult> {
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
                sourcePath: "/app",
                signal: opts?.signal || this.signal
            });

            if (!resp.ok) {
                let snippet = "";
                try {
                    snippet = (await resp.text()).slice(0, 320);
                } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:geminiClient.ts]", e); }

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
                    label: "getConversationList"
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
        async getAllConversations(maxPages: number | PaginationOptions = 2000, onProgress?: any, targetSid?: string | null, opts?: any): Promise<PaginationResult> {
            if (pagination.getAllConversations) {
                return pagination.getAllConversations(this, maxPages, onProgress, targetSid, opts);
            }
            throw new Error("pagination module not found");
        }

        async fetchConversationPage(conversationId: string, pageToken?: string | null, targetSid?: string | null, opts?: any): Promise<DetailParseResult> {
            let id = conversationId.startsWith("c_") ? conversationId : `c_${conversationId}`;
            let cred = await resolveCred(targetSid, opts && (opts._overrideAt || opts._overrideBl) ? { at: opts._overrideAt, bl: opts._overrideBl } : null);
            let api = getApiUrl(cred.accountSlot || "default");
            const isDevMode = !!(getUtils()?.isDevMode ? getUtils().isDevMode() : false);
            if (isDevMode) {
                console.log(`[Gemini Exporter Client] fetchConversationPage start: ${id}, api: ${api}, slot: ${cred.accountSlot}, hasAt: ${Boolean(cred.at)}, atLen: ${(cred.at || "").length}`);
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
                timeoutMs: 15000,
                signal: opts?.signal || this.signal
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
            } catch (err: any) {
                const isDeletedOrInaccessible = text && (text.includes("BardErrorInfo") || text.includes("1167"));
                if (isDeletedOrInaccessible) {
                    if (isDevMode) {
                        console.info(`[Gemini Exporter Client] Conversation ${id} is inaccessible or deleted on server (BardErrorInfo: 1167). Skipping.`);
                    }
                    throw new Error(`会话已在服务端删除或不可访问 (${id})`);
                }
                console.error(`[Gemini Exporter Client] parseDetail failed for ${id}:`, err.message, "raw text snippet:", text.slice(0, 400));
                throw new Error(`解析详情失败 (${err.message}): ${text.slice(0, 100)}`);
            }
        }

        async getConversationDetail(conversationId: string, targetSid?: string | null): Promise<DetailParseResult> {
            if (pagination.getConversationDetail) {
                return pagination.getConversationDetail(this, conversationId, targetSid);
            }
            throw new Error("pagination module not found");
        }

        // @contentScriptOnly — requires live page DOM, guarded for non-DOM environments
        getCurrentConversationId(): string | null {
            if (typeof document === "undefined") return null;
            try {
                let u = new URL(global.location.href);
                let parts = u.pathname.split("/");
                let idx = parts.indexOf("app");
                if (idx !== -1 && idx < parts.length - 1) return parts[idx + 1];
                let g = parts.indexOf("gem");
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

    if (typeof module !== "undefined" && module.exports) {
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
