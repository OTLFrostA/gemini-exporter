// geminiParser.js - Facade for Gemini RPC response parsing engine
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(root);
    } else {
        const exports = factory(root);
        root.GeminiResponseParserClass = exports.GeminiResponseParserClass;
        root.isRealTitle = exports.isRealTitle;
        root.cleanTitle = exports.cleanTitle;
        root.normId = exports.normId;
        root.GEMINI_JSPB_SCHEMA = exports.GEMINI_JSPB_SCHEMA;
        root.detectTurnSchemaDrift = exports.detectTurnSchemaDrift;
        root.extractListItemTimestamp = exports.extractListItemTimestamp;
    }
}(typeof self !== 'undefined' ? self : this, function(rootContext) {
    'use strict';

    function resolveModule(globalName, relPath) {
        if (typeof globalThis !== 'undefined' && globalThis[globalName]) return globalThis[globalName];
        if (typeof self !== 'undefined' && self[globalName]) return self[globalName];
        if (rootContext && rootContext[globalName]) return rootContext[globalName];
        if (typeof require !== 'undefined') {
            try { return require(relPath); } catch (_) {}
        }
        return null;
    }

    const ext = resolveModule('GeminiParserExtractors', './parser/extractors.js') || {};
    const att = resolveModule('GeminiParserAttachments', './parser/attachments.js') || {};
    const listMod = resolveModule('GeminiParserParseList', './parser/parseList.js') || {};
    const detailMod = resolveModule('GeminiParserParseDetail', './parser/parseDetail.js') || {};

    const GEMINI_JSPB_SCHEMA = ext.GEMINI_JSPB_SCHEMA || Object.freeze({
        TURN: { ID_META: 0, TIMESTAMP: 1, USER_PAYLOAD: 2, MODEL_PAYLOAD: 3 },
        MODEL_PAYLOAD: { CANDIDATES: 0, SEARCH_QUERIES: 1, PROVIDER: 2, TELEMETRY_START: 3 },
        CANDIDATE: { ID: 0, BODY: 1, LANGUAGE_CODE: 2 },
        CANDIDATE_BODY: { PARTS: 0 },
        LIST_ITEM: { ID: 0, TITLE: 1, TIMESTAMP: 5, UPDATE_TIME_ALT: 2, CREATE_TIME_ALT: 3, COUNT_ALT1: 4, COUNT_ALT2: 9 }
    });

    const detectTurnSchemaDrift = ext.detectTurnSchemaDrift || function() { return { isDrifted: false, warnings: [] }; };
    const extractModelCandidates = ext.extractModelCandidates || function() { return []; };
    const extractCandidateText = ext.extractCandidateText || function() { return ""; };
    const robustFirstPayload = ext.robustFirstPayload || function(t) { try { return JSON.parse(t); } catch (_) { return null; } };
    const safeStructureClean = ext.safeStructureClean || function(s) { return s || ""; };
    const deepWalk = ext.deepWalk || function(r, v) { if (r) v(r); };
    const extractThoughts = ext.extractThoughts || function() { return null; };
    const extractCitations = ext.extractCitations || function() { return []; };
    const extractConversationId = ext.extractConversationId || function(inner) { return inner?.[0] || 'c_unknown'; };
    const smartSummarizePrompt = ext.smartSummarizePrompt || function(t) { return String(t || '').trim(); };
    const extractConversationTitle = ext.extractConversationTitle || function() { return { title: '未命名对话', source: 'default' }; };
    const extractMetaTitleFromTop = ext.extractMetaTitleFromTop || function() { return null; };
    const extractTurnTimestamp = ext.extractTurnTimestamp || function() { return null; };
    const isRealTitle = ext.isRealTitle || function(t) { return !!(t && String(t).trim().length >= 2); };
    const cleanTitle = ext.cleanTitle || function(t) { return String(t || '').trim(); };
    const normId = ext.normId || function(id) { return String(id || '').replace(/^c_/, '').trim(); };

    const extractImageSelectionIndex = att.extractImageSelectionIndex || function() { return undefined; };
    const getImageDedupKey = att.getImageDedupKey || function(img) { return img?.sourceUrl || img?.token || ''; };
    const filterNewImages = att.filterNewImages || function(imgs) { return imgs || []; };
    const highResVariant = att.highResVariant || function(u) { return u; };
    const isInternalChipUrl = att.isInternalChipUrl || function() { return false; };
    const extractImages = att.extractImages || function() { return []; };
    const extractUserFiles = att.extractUserFiles || function() { return []; };
    const extractDocumentsMeta = att.extractDocumentsMeta || function() { return []; };
    const findDocContentById = att.findDocContentById || function() { return null; };
    const parseDocSections = att.parseDocSections || function() { return { sections: [], links: [], contentMarkdown: "" }; };
    const findDocMarkdownByClues = att.findDocMarkdownByClues || function() { return ""; };

    const extractListItemTimestamp = listMod.extractListItemTimestamp || function() { return null; };
    const parseList = listMod.parseList || function() { return { conversations: [], nextPageToken: null }; };
    const parseDetail = detailMod.parseDetail || function() { return { messages: [] }; };
    const findTurnsDeep = detailMod.findTurnsDeep || function() { return null; };

    /**
     * Facade object exporting all 26 canonical parsing methods and schemas.
     * Preserves 100% backward compatibility with all test suites and browser modules.
     */
    const GeminiResponseParserClass = {
        GEMINI_JSPB_SCHEMA,
        detectTurnSchemaDrift,
        extractModelCandidates,
        extractCandidateText,
        robustFirstPayload,
        extractTurnTimestamp,
        extractImageSelectionIndex,
        getImageDedupKey,
        filterNewImages,
        highResVariant,
        extractImages,
        extractUserFiles,
        extractDocumentsMeta,
        findDocContentById,
        parseDocSections,
        findDocMarkdownByClues,
        extractThoughts,
        extractCitations,
        extractConversationId,
        extractConversationTitle,
        isRealTitle,
        cleanTitle,
        normId,
        extractListItemTimestamp,
        parseList,
        parseDetail,
        // Utility methods
        safeStructureClean,
        deepWalk,
        smartSummarizePrompt,
        extractMetaTitleFromTop,
        isInternalChipUrl,
        findTurnsDeep
    };

    return {
        GeminiResponseParserClass,
        isRealTitle,
        cleanTitle,
        normId,
        GEMINI_JSPB_SCHEMA,
        detectTurnSchemaDrift,
        extractListItemTimestamp,
        extractors: ext,
        attachments: att,
        parseList: listMod,
        parseDetail: detailMod
    };
}));
