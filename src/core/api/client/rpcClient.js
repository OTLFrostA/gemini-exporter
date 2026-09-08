// rpcClient.js - Low-level HTTP POST and batchexecute RPC communication
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GeminiClientRpcClient = factory();
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function() {
    'use strict';

    const GEMINI_API_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute";

    let __protocol = null;
    function getProtocol() {
        if (__protocol) return __protocol;
        if (typeof globalThis !== 'undefined' && globalThis.GeminiProtocol) {
            __protocol = globalThis.GeminiProtocol;
        } else if (typeof require !== 'undefined') {
            try { __protocol = require('../../protocol/protocol.js'); } catch (_) {
                try { __protocol = require('../protocol/protocol.js'); } catch (_) {}
            }
        }
        if (!__protocol) throw new Error('GeminiProtocol not found. Make sure core/protocol/protocol.js is loaded.');
        return __protocol;
    }

    const nextReqid = getProtocol().createReqidGenerator();

    function getUtils() {
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils) return globalThis.GeminiUtils;
        if (typeof require !== 'undefined') {
            try { return require('../../utils/utils.js'); } catch (_) {
                try { return require('../utils/utils.js'); } catch (_) {}
            }
        }
        return null;
    }

    function getParser() {
        if (typeof globalThis !== 'undefined' && globalThis.GeminiResponseParserClass) {
            return globalThis.GeminiResponseParserClass;
        }
        if (typeof self !== 'undefined' && self.GeminiResponseParserClass) {
            return self.GeminiResponseParserClass;
        }
        if (typeof require !== 'undefined') {
            try { return require('../geminiParser.js').GeminiResponseParserClass; } catch (_) {}
            try { return require('./geminiParser.js').GeminiResponseParserClass; } catch (_) {}
        }
        throw new Error('GeminiResponseParserClass not found. Make sure geminiParser.js is loaded.');
    }

    function getApiUrl(slot) {
        if (slot && slot !== "default") {
            let t = slot.replace(/^u/, "/u/");
            return `https://gemini.google.com${t}/_/BardChatUi/data/batchexecute`;
        }
        return GEMINI_API_URL;
    }

    function generateFallbackSid() {
        return String(Math.floor(Math.random() * 1e19));
    }

    /**
     * Executes raw batchexecute POST request with automatic timeout and signal handling
     */
    async function postBatchexecute(options) {
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

        let controller = null;
        let timeoutId = null;

        if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
            controller = new AbortController();
            timeoutId = setTimeout(() => {
                try { controller.abort(); } catch (_) {}
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
