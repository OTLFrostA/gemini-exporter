// takeoutEngine.js - Google Takeout ZIP extraction and offline media fallback engine facade
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TakeoutEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    const getMediaIndex = () => {
        if (typeof MediaIndex !== 'undefined') return MediaIndex;
        if (typeof globalThis !== 'undefined' && globalThis.MediaIndex) return globalThis.MediaIndex;
        if (typeof require !== 'undefined') {
            try { return require('./takeout/mediaIndex.js'); } catch { /* intentional */ }
        }
        return null;
    };

    const getTakeoutParser = () => {
        if (typeof TakeoutParser !== 'undefined') return TakeoutParser;
        if (typeof globalThis !== 'undefined' && globalThis.TakeoutParser) return globalThis.TakeoutParser;
        if (typeof require !== 'undefined') {
            try { return require('./takeout/takeoutParser.js'); } catch { /* intentional */ }
        }
        return null;
    };

    const getZipBombGuard = () => {
        if (typeof ZipBombGuard !== 'undefined') return ZipBombGuard;
        if (typeof globalThis !== 'undefined' && globalThis.ZipBombGuard) return globalThis.ZipBombGuard;
        if (typeof require !== 'undefined') {
            try { return require('./takeout/zipBombGuard.js'); } catch { /* intentional */ }
        }
        return null;
    };

    // Per-slot Takeout isolation SSoT routing
    const __slotTakeouts = new Map();
    function getStore(slot) {
        const media = getMediaIndex();
        if (media && media.getStore) return media.getStore(slot);
        if (slot && __slotTakeouts.has(slot)) return __slotTakeouts.get(slot);
        return { mediaMap: {}, globalMedia: {}, convCache: {} };
    }

    function getTakeoutOfflineChat(chatId, slot) {
        const media = getMediaIndex();
        if (media && media.getTakeoutOfflineChat) return media.getTakeoutOfflineChat(chatId, slot);
        return null;
    }

    function getTakeoutMediaForChat(chatId, slot) {
        const media = getMediaIndex();
        if (media && media.getTakeoutMediaForChat) return media.getTakeoutMediaForChat(chatId, slot);
        return [];
    }

    async function getTakeoutFallbackMedia(chatId, filenameOrId, slot) {
        const media = getMediaIndex();
        if (media && media.getTakeoutFallbackMedia) return await media.getTakeoutFallbackMedia(chatId, filenameOrId, slot);
        return null;
    }

    function extractC2PATimestamp(bufferOrArray) {
        const media = getMediaIndex();
        if (media && media.extractC2PATimestamp) return media.extractC2PATimestamp(bufferOrArray);
        return null;
    }

    function clearTakeoutData(slot) {
        const media = getMediaIndex();
        if (media && media.clearTakeoutData) media.clearTakeoutData(slot);
        if (slot) __slotTakeouts.delete(slot);
        else __slotTakeouts.clear();
    }

    async function parseTakeoutZip(file, onProgress, slot = null) {
        const parser = getTakeoutParser();
        if (parser && parser.parseTakeoutZip) {
            return await parser.parseTakeoutZip(file, onProgress, slot);
        }
        throw new Error('TakeoutParser sub-module not found');
    }

    return {
        getTakeoutOfflineChat,
        getTakeoutFallbackMedia,
        getTakeoutMediaForChat,
        extractC2PATimestamp,
        parseTakeoutZip,
        clearTakeoutData,
        getStore,
        __slotTakeouts
    };
}));
