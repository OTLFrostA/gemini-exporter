import MediaIndex, { type MediaIndexModule, type TakeoutStore } from "./takeout/mediaIndex.js";
import TakeoutParser, { type TakeoutParserModule, type TakeoutParseResult } from "./takeout/takeoutParser.js";
import ZipBombGuard, { type ZipBombGuardModule } from "./takeout/zipBombGuard.js";

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

const getMediaIndex = (): MediaIndexModule => {
    if (typeof globalThis !== 'undefined' && (globalThis as any).MediaIndex) return (globalThis as any).MediaIndex;
    return MediaIndex;
};

const getTakeoutParser = (): TakeoutParserModule => {
    if (typeof globalThis !== 'undefined' && (globalThis as any).TakeoutParser) return (globalThis as any).TakeoutParser;
    return TakeoutParser;
};

const getZipBombGuard = (): ZipBombGuardModule => {
    if (typeof globalThis !== 'undefined' && (globalThis as any).ZipBombGuard) return (globalThis as any).ZipBombGuard;
    return ZipBombGuard;
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

export {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    parseTakeoutZip,
    clearTakeoutData,
    getStore,
    __slotTakeouts
};

export const TakeoutEngine: TakeoutEngineModule = {
    getTakeoutOfflineChat,
    getTakeoutFallbackMedia,
    getTakeoutMediaForChat,
    extractC2PATimestamp,
    parseTakeoutZip,
    clearTakeoutData,
    getStore,
    __slotTakeouts
};

(TakeoutEngine as any).TakeoutEngine = TakeoutEngine;
(TakeoutEngine as any).default = TakeoutEngine;

if (typeof globalThis !== 'undefined' && !(globalThis as any).TakeoutEngine) {
    (globalThis as any).TakeoutEngine = TakeoutEngine;
}
if (typeof module === 'object' && module.exports) {
    module.exports = TakeoutEngine;
}
export default TakeoutEngine;
