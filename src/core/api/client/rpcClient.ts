// rpcClient.ts - Low-level HTTP POST and batchexecute RPC communication
import type { GeminiProtocolModule } from "../../protocol/protocol.js";

const GEMINI_API_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute";

export interface RpcRequestOptions {
    api: string;
    rpcids: string;
    fReq: string;
    cred?: any;
    sourcePath?: string;
    timeoutMs?: number;
    signal?: AbortSignal | null;
}

export interface GeminiClientRpcClientModule {
    GEMINI_API_URL: string;
    getProtocol: () => GeminiProtocolModule;
    getUtils: () => any;
    getParser: () => any;
    getApiUrl: (slot?: string | null) => string;
    nextReqid: () => string;
    generateFallbackSid: () => string;
    postBatchexecute: (options: RpcRequestOptions) => Promise<Response>;
}

declare global {
    var GeminiClientRpcClient: GeminiClientRpcClientModule;
}

(function(root: any, factory: () => GeminiClientRpcClientModule) {
    if (typeof define === "function" && (define as any).amd) {
        (define as any)([], factory);
    } else if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.GeminiClientRpcClient = factory();
    }
}(typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this), function(): GeminiClientRpcClientModule {
    "use strict";

    let __protocol: GeminiProtocolModule | null = null;
    function getProtocol(): GeminiProtocolModule {
        if (__protocol) return __protocol;
        if (typeof globalThis !== "undefined" && (globalThis as any).GeminiProtocol) {
            __protocol = (globalThis as any).GeminiProtocol;
        } else if (typeof require !== "undefined") {
            try { __protocol = require("../../protocol/protocol.js"); } catch (_) {
                try { __protocol = require("../protocol/protocol.js"); } catch (_) {}
            }
        }
        if (!__protocol) throw new Error("GeminiProtocol not found. Make sure core/protocol/protocol.js is loaded.");
        return __protocol;
    }

    const nextReqid = getProtocol().createReqidGenerator();

    function getUtils(): any {
        if (typeof globalThis !== "undefined" && (globalThis as any).GeminiUtils) return (globalThis as any).GeminiUtils;
        if (typeof require !== "undefined") {
            try { return require("../../utils/utils.js"); } catch (_) {
                try { return require("../utils/utils.js"); } catch (_) {}
            }
        }
        return null;
    }

    function getParser(): any {
        if (typeof globalThis !== "undefined" && (globalThis as any).GeminiResponseParserClass) {
            return (globalThis as any).GeminiResponseParserClass;
        }
        if (typeof self !== "undefined" && (self as any).GeminiResponseParserClass) {
            return (self as any).GeminiResponseParserClass;
        }
        if (typeof require !== "undefined") {
            try { return require("../geminiParser.js").GeminiResponseParserClass; } catch (_) {}
            try { return require("./geminiParser.js").GeminiResponseParserClass; } catch (_) {}
        }
        throw new Error("GeminiResponseParserClass not found. Make sure geminiParser.js is loaded.");
    }

    function getApiUrl(slot?: string | null): string {
        if (slot && slot !== "default") {
            let t = slot.startsWith("/") ? slot : (slot.startsWith("u/") ? `/${slot}` : slot.replace(/^u/, "/u/"));
            return `https://gemini.google.com${t}/_/BardChatUi/data/batchexecute`;
        }
        return GEMINI_API_URL;
    }

    function generateFallbackSid(): string {
        return String(Math.floor(Math.random() * 1e19));
    }

    /**
     * Executes raw batchexecute POST request with automatic timeout and signal handling
     */
    async function postBatchexecute(options: RpcRequestOptions): Promise<Response> {
        const {
            api,
            rpcids,
            fReq,
            cred,
            sourcePath = "/app",
            timeoutMs = 0,
            signal
        } = options;

        const P = getProtocol();
        const params = new URLSearchParams({
            rpcids,
            "source-path": sourcePath,
            bl: cred?.bl || P.BL_FALLBACK,
            "f.sid": cred?.sid || generateFallbackSid(),
            _reqid: nextReqid(),
            rt: "c"
        });

        const body = new URLSearchParams();
        body.append("f.req", fReq);
        if (cred?.at) body.append("at", cred.at);

        let controller: AbortController | null = null;
        let timeoutId: any = null;

        if (timeoutMs > 0 && typeof AbortController !== "undefined") {
            controller = new AbortController();
            timeoutId = setTimeout(() => {
                try { controller?.abort(); } catch (_) {}
            }, timeoutMs);
        }

        try {
            const resp = await fetch(`${api}?${params}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: body.toString(),
                credentials: "include",
                signal: signal || (controller ? controller.signal : undefined)
            });
            return resp;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    return {
        GEMINI_API_URL,
        getProtocol,
        getUtils,
        getParser,
        getApiUrl,
        nextReqid,
        generateFallbackSid,
        postBatchexecute
    };
}));
