// takeoutEngine.ts - Google Takeout ZIP extraction and offline media fallback engine facade
import type { MediaIndexModule, TakeoutStore } from "./takeout/mediaIndex.js";
import type { TakeoutParserModule, TakeoutParseResult } from "./takeout/takeoutParser.js";
import type { ZipBombGuardModule } from "./takeout/zipBombGuard.js";

export interface TakeoutEngineModule {
    getTakeoutOfflineChat: (chatId: string, slot?: string | null) => any;
    getTakeoutFallbackMedia: (chatId: string, filenameOrId: string, slot?: string | null) => Promise<Uint8Array | null>;
    getTakeoutMediaForChat: (chatId: string, slot?: string | null) => any[];
    extractC2PATimestamp: (bufferOrArray: any) => number | null;
    parseTakeoutZip: (file: any, onProgress?: ((pct: number, msg: string) => void) | null, slot?: string | null) => Promise<TakeoutParseResult>;
    clearTakeoutData: (slot?: string | null) => void;
    getStore: (slot?: string | null) => TakeoutStore;
    __slotTakeouts: Map<string, TakeoutStore>;
}

declare global {
    var TakeoutEngine: TakeoutEngineModule;
}

(function(root: any, factory: () => TakeoutEngineModule) {
    if (typeof define === 'function' && (define as any).amd) {
        (define as any)([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TakeoutEngine = factory();
    }
}(typeof self !== 'undefined' ? self : this, function(): TakeoutEngineModule {
    'use strict';

    const getMediaIndex = (): MediaIndexModule | null => {
        if (typeof MediaIndex !== 'undefined') return MediaIndex;
        if (typeof globalThis !== 'undefined' && (globalThis as any).MediaIndex) return (globalThis as any).MediaIndex;
        if (typeof require !== 'undefined') {
            try { return require('./takeout/mediaIndex.js'); } catch { /* intentional */ }
        }
        return null;
    };

    const getTakeoutParser = (): TakeoutParserModule | null => {
        if (typeof TakeoutParser !== 'undefined') return TakeoutParser;
        if (typeof globalThis !== 'undefined' && (globalThis as any).TakeoutParser) return (globalThis as any).TakeoutParser;
        if (typeof require !== 'undefined') {
            try { return require('./takeout/takeoutParser.js'); } catch { /* intentional */ }
        }
        return null;
    };

    const getZipBombGuard = (): ZipBombGuardModule | null => {
        if (typeof ZipBombGuard !== 'undefined') return ZipBombGuard;
        if (typeof globalThis !== 'undefined' && (globalThis as any).ZipBombGuard) return (globalThis as any).ZipBombGuard;
        if (typeof require !== 'undefined') {
            try { return require('./takeout/zipBombGuard.js'); } catch { /* intentional */ }
        }
        return null;
    };

    // Per-slot Takeout isolation SSoT routing
    const __slotTakeouts = new Map<string, TakeoutStore>();
    function getStore(slot?: string | null): TakeoutStore {
        const media = getMediaIndex();
        if (media && media.getStore) return media.getStore(slot);
        if (slot && __slotTakeouts.has(slot)) return __slotTakeouts.get(slot)!;
        return { mediaMap: {}, globalMedia: {}, convCache: {} };
    }

    function getTakeoutOfflineChat(chatId: string, slot?: string | null): any {
        const media = getMediaIndex();
        if (media && media.getTakeoutOfflineChat) return media.getTakeoutOfflineChat(chatId, slot);
        return null;
    }

    function getTakeoutMediaForChat(chatId: string, slot?: string | null): any[] {
        const media = getMediaIndex();
        if (media && media.getTakeoutMediaForChat) return media.getTakeoutMediaForChat(chatId, slot);
        return [];
    }

    async function getTakeoutFallbackMedia(chatId: string, filenameOrId: string, slot?: string | null): Promise<Uint8Array | null> {
        const media = getMediaIndex();
        if (media && media.getTakeoutFallbackMedia) return await media.getTakeoutFallbackMedia(chatId, filenameOrId, slot);
        return null;
    }

    function extractC2PATimestamp(bufferOrArray: any): number | null {
        const media = getMediaIndex();
        if (media && media.extractC2PATimestamp) return media.extractC2PATimestamp(bufferOrArray);
        return null;
    }

    function clearTakeoutData(slot?: string | null): void {
        const media = getMediaIndex();
        if (media && media.clearTakeoutData) media.clearTakeoutData(slot);
        if (slot) __slotTakeouts.delete(slot);
        else __slotTakeouts.clear();
    }

    async function parseTakeoutZip(file: any, onProgress?: ((pct: number, msg: string) => void) | null, slot: string | null = null): Promise<TakeoutParseResult> {
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
