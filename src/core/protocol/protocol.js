// protocol/protocol.js — protocol anti-corruption layer (Phase 1).
//
// Single source of truth for every piece of Google-side reverse-engineered
// knowledge: RPC endpoint names, the batchexecute wrapper format, token
// key names and extraction patterns, the fallback build number, sliding
// window limits, and the request-id convention.
//
// When Google rotates any of these, fix THIS module only. Consumers:
//   geminiClient, geminiParser, hookCredentials (MAIN world), messageBridge,
//   bootstrap. Load order: protocol.js must load before all of them —
//   manifest content_scripts (both worlds), background importScripts,
//   options.html and popup.html script tags.
//
// Remote hot-fix note: this module is deliberately data-shaped so it can be
// externalized to a remotely-updatable JSON profile later (Chrome Web Store
// allows remote data, not remote code).

(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GeminiProtocol = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    const PROTOCOL_VERSION = '2026-09-07';

    // batchexecute wrapper: every payload row is ["wrb.fr", "<rpc>", "<json string>", ...]
    const WRB = 'wrb.fr';

    // RPC endpoint names (compiled Google-side identifiers — rotate together
    // with WRB consumers when Google redeploys).
    const RPCS = {
        LIST: 'MaZiqc',        // conversation list (sidebar pagination)
        DETAIL: 'hNvQHb',      // conversation detail (turns payload)
        LEGACY_LIST: 'b7Lged', // legacy list payload shape still returned by detail calls
        GEMS: 'CNgdBe',        // gems/custom instructions list (currently unused, kept for reference)
        DELETE: 'GzXR5e'       // conversation delete (deletion sniffing anchor)
    };

    // WIZ_global_data token key names.
    const TOKENS = {
        AT: 'SNlM0e', // XSRF/at token
        BL: 'cfb2h'   // frontend build label key (the "bl" request param)
    };

    // Extraction patterns for tokens from page HTML/scripts.
    const TOKEN_PATTERNS = {
        atFromScript: /"SNlM0e"\s*:\s*"([^"]+)"/,
        atGenericFromScript: /"at"\s*:\s*"([^"]{20,})"/,
        blKeyFromScript: /"bl"\s*:\s*"([^"]+)"/,
        blValueFromHtml: /"bl":"(boq_[^"]+)"/,
        blCfb2hFromHtml: /"cfb2h"\s*:\s*"([^"]+)"/,
        blAssistantFromHtml: /"bl"\s*:\s*"(boq_assistant[^"]+)"/,
        boqBuildFromScript: /boq_assistant-bard-web-server_[^"']+/
    };

    // Deletion sniffing: the deleted conversation id must be anchored to the
    // GzXR5e payload context (#194) — never take the first hex token in the
    // response text.
    const DELETION_ANCHORS = [
        /GzXR5e[^\w]{1,60}["'](?:c_)?([a-f0-9]{8,64})["']/i,
        /["']GzXR5e["'][\s\S]{1,120}?["'](?:c_)?([a-f0-9]{8,64})["']/i
    ];

    // Fallback frontend build label. WARNING: dated build numbers expire and
    // then trigger HTTP 400 — TOKEN_PATTERNS.bl* extraction normally supplies
    // a fresh one; this is last-resort only. Keep in sync with the live
    // frontend when rotating protocol profiles.
    const BL_FALLBACK = 'boq_assistant-bard-web-server_20260802.09_p1';

    // Conversation count limits. 500 is Google's sliding-window size: counts
    // reaching it trigger the Takeout guidance flow. SERVER_LIMIT_TEXT is the
    // (localized-ish) marker inside the server-side error message.
    const LIMITS = {
        SLIDING_WINDOW: 500,
        SERVER_LIMIT_TEXT: '600条'
    };

    // Real frontends use an incrementing _reqid starting from a random base;
    // a pure Math.random() per request is a fingerprintable deviation.
    function createReqidGenerator() {
        let n = 100000 + Math.floor(Math.random() * 900000);
        return function nextReqid() {
            return String(n++);
        };
    }

    return {
        PROTOCOL_VERSION,
        WRB,
        RPCS,
        TOKENS,
        TOKEN_PATTERNS,
        DELETION_ANCHORS,
        BL_FALLBACK,
        LIMITS,
        createReqidGenerator
    };
}));
