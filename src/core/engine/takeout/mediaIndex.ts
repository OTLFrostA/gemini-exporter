// mediaIndex.ts - Offline media indexing, per-slot isolation, and C2PA timestamp extraction
import type { GeminiUtilsModule } from "../../utils/utils.js";

export interface TakeoutStore {
    mediaMap: Record<string, any>;
    globalMedia: Record<string, any>;
    convCache: Record<string, any>;
}

export interface MediaIndexModule {
    getStore: (slot?: string | null) => TakeoutStore;
    normId: (id?: string | null) => string;
    extractC2PATimestamp: (bufferOrArray: any) => number | null;
    getTakeoutOfflineChat: (chatId: string, slot?: string | null) => any;
    getTakeoutMediaForChat: (chatId: string, slot?: string | null) => any[];
    getTakeoutFallbackMedia: (chatId: string, filenameOrId: string, slot?: string | null) => Promise<Uint8Array | null>;
    commitTakeoutData: (slot: string | null | undefined, data: TakeoutStore) => void;
    clearTakeoutData: (slot?: string | null) => void;
    __slotTakeouts: Map<string, TakeoutStore>;
}

declare global {
    var MediaIndex: MediaIndexModule;
}

(function(root: any, factory: () => MediaIndexModule) {
    if (typeof define === 'function' && (define as any).amd) {
        (define as any)([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MediaIndex = factory();
    }
}(typeof self !== 'undefined' ? self : this, function(): MediaIndexModule {
    'use strict';

    const __slotTakeouts = new Map<string, TakeoutStore>();
    let __takeoutMediaMap: Record<string, any> = {};
    let __takeoutGlobalMedia: Record<string, any> = {};
    let __takeoutConvCache: Record<string, any> = {};

    function getStore(slot?: string | null): TakeoutStore {
        if (slot && __slotTakeouts.has(slot)) {
            return __slotTakeouts.get(slot)!;
        }
        return {
            mediaMap: __takeoutMediaMap,
            globalMedia: __takeoutGlobalMedia,
            convCache: __takeoutConvCache
        };
    }

    function getUtils(): GeminiUtilsModule | null {
        if (typeof GeminiUtils !== 'undefined') return GeminiUtils;
        if (typeof globalThis !== 'undefined' && (globalThis as any).GeminiUtils) return (globalThis as any).GeminiUtils;
        if (typeof require !== 'undefined') {
            try { return require('../../utils/utils.js'); } catch { /* intentional */ }
        }
        return null;
    }

    function normId(id?: string | null): string {
        try {
            const u = getUtils();
            if (u && u.normId) return u.normId(id);
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e);
        }
        if (!id) return '';
        return String(id).replace(/^c_/, '').trim();
    }

    function extractC2PATimestamp(bufferOrArray: any): number | null {
        if (!bufferOrArray) return null;
        let str = '';
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bufferOrArray)) {
            str = bufferOrArray.toString('binary');
        } else if (bufferOrArray instanceof Uint8Array || ArrayBuffer.isView(bufferOrArray)) {
            const byteLen = (bufferOrArray as any).byteLength ?? (bufferOrArray as any).length ?? 0;
            const len = Math.min(byteLen, 65536);
            const view = new Uint8Array((bufferOrArray as any).buffer || bufferOrArray, (bufferOrArray as any).byteOffset || 0, len);
            let s = '';
            for (let i = 0; i < len; i++) {
                s += String.fromCharCode(view[i]);
            }
            str = s;
        } else if (typeof bufferOrArray === 'string') {
            str = bufferOrArray;
        }
        const m = str.match(/(20\d{2}[01]\d[0-3]\d[0-2]\d[0-5]\d[0-5]\dZ)/);
        if (!m) return null;
        const s = m[1];
        const year = parseInt(s.slice(0, 4), 10);
        const month = parseInt(s.slice(4, 6), 10);
        const day = parseInt(s.slice(6, 8), 10);
        const hour = parseInt(s.slice(8, 10), 10);
        const min = parseInt(s.slice(10, 12), 10);
        const sec = parseInt(s.slice(12, 14), 10);
        return Date.UTC(year, month - 1, day, hour, min, sec);
    }

    function getTakeoutOfflineChat(chatId: string, slot?: string | null): any {
        if (!chatId) return null;
        const nid = normId(chatId);
        const store = getStore(slot);
        return store.convCache[nid] || __takeoutConvCache[nid] || null;
    }

    function getTakeoutMediaForChat(chatId: string, slot?: string | null): any[] {
        if (!chatId) return [];
        const nid = normId(chatId);
        const store = getStore(slot);
        return (store.mediaMap && store.mediaMap[nid]) || __takeoutMediaMap[nid] || [];
    }

    async function getTakeoutFallbackMedia(chatId: string, filenameOrId: string, slot?: string | null): Promise<Uint8Array | null> {
        if (!filenameOrId) return null;
        const nid = normId(chatId);
        const store = getStore(slot);
        const mediaMap = store.mediaMap || __takeoutMediaMap;
        const globalMedia = store.globalMedia || __takeoutGlobalMedia;

        let target = String(filenameOrId).replace(/^.*[\\\/]/, '').trim();
        try { target = decodeURIComponent(target); } catch { /* intentional */ }
        let targetStem = target.replace(/\.[^/.]+$/, '').toLowerCase();
        let cleanTargetStem = targetStem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
        let cleanTarget = target.replace(/^[0-9a-fA-F]{4,16}_+/, '').trim();

        const convMedia = mediaMap[nid];
        if (convMedia && convMedia.length) {
            for (const item of convMedia) {
                let itemFilename = item.filename;
                let itemStem = itemFilename.replace(/\.[^/.]+$/, '').toLowerCase();
                let cleanItemStem = itemStem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
                if (itemFilename === target || itemFilename === cleanTarget || itemStem === cleanTargetStem || cleanItemStem === cleanTargetStem || cleanItemStem === targetStem || (cleanItemStem.length > 3 && cleanTargetStem.includes(cleanItemStem)) || (cleanTargetStem.length > 3 && cleanItemStem.includes(cleanTargetStem))) {
                    try {
                        let bin = await item.fileObj.async('uint8array');
                        if (bin && bin.length > 0) return bin;
                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e); }
                }
            }
            if (convMedia.length === 1 && (/^image(?:-\d+)?$/i.test(cleanTargetStem) || /^file/i.test(cleanTargetStem) || /^asset/i.test(cleanTargetStem))) {
                try {
                    let bin = await convMedia[0].fileObj.async('uint8array');
                    if (bin && bin.length > 0) return bin;
                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e); }
            }
        }

        const isGenericName = (s: string) => /^(?:image(?:[_-]?\d+)?|file(?:[_-]?\d+)?|asset(?:[_-]?\d+)?|media(?:[_-]?\d+)?|thumb(?:nail)?(?:[_-]?\d+)?)$/i.test(s);

        if (!isGenericName(cleanTargetStem) && !isGenericName(targetStem)) {
            if (globalMedia[cleanTargetStem] || globalMedia[targetStem] || globalMedia[cleanTarget] || globalMedia[target]) {
                const fObj = globalMedia[cleanTargetStem] || globalMedia[targetStem] || globalMedia[cleanTarget] || globalMedia[target];
                try {
                    let bin = await fObj.async('uint8array');
                    if (bin && bin.length > 0) return bin;
                } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e); }
            }
        }

        for (const [stem, fileObj] of Object.entries(globalMedia)) {
            const hasNid = nid && (stem.includes(nid) || ((fileObj as any).name && (fileObj as any).name.includes(nid)));
            let cleanStem = stem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();

            if (hasNid) {
                if (cleanStem === cleanTargetStem || stem === targetStem ||
                    (cleanStem.length > 4 && (cleanStem.includes(cleanTargetStem) || cleanTargetStem.includes(cleanStem)))) {
                    try {
                        let bin = await (fileObj as any).async('uint8array');
                        if (bin && bin.length > 0) return bin;
                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e); }
                }
            } else if (!isGenericName(cleanTargetStem) && !isGenericName(cleanStem)) {
                if (cleanStem === cleanTargetStem || stem === targetStem) {
                    try {
                        let bin = await (fileObj as any).async('uint8array');
                        if (bin && bin.length > 0) return bin;
                    } catch (e) { if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e); }
                }
            }
        }

        return null;
    }

    function commitTakeoutData(slot: string | null | undefined, { mediaMap, globalMedia, convCache }: TakeoutStore): void {
        __takeoutMediaMap = mediaMap;
        __takeoutGlobalMedia = globalMedia;
        __takeoutConvCache = convCache;
        if (slot) {
            __slotTakeouts.set(slot, {
                mediaMap,
                globalMedia,
                convCache
            });
        }
    }

    function clearTakeoutData(slot?: string | null): void {
        if (slot && __slotTakeouts.has(slot)) {
            const slotData = __slotTakeouts.get(slot);
            if (slotData) {
                if (__takeoutMediaMap === slotData.mediaMap) __takeoutMediaMap = {};
                if (__takeoutGlobalMedia === slotData.globalMedia) __takeoutGlobalMedia = {};
                if (__takeoutConvCache === slotData.convCache) __takeoutConvCache = {};
            }
            __slotTakeouts.delete(slot);
        } else {
            __slotTakeouts.clear();
            __takeoutMediaMap = {};
            __takeoutGlobalMedia = {};
            __takeoutConvCache = {};
        }
        if (__slotTakeouts.size === 0) {
            __takeoutMediaMap = {};
            __takeoutGlobalMedia = {};
            __takeoutConvCache = {};
        }
    }

    return {
        getStore,
        normId,
        extractC2PATimestamp,
        getTakeoutOfflineChat,
        getTakeoutMediaForChat,
        getTakeoutFallbackMedia,
        commitTakeoutData,
        clearTakeoutData,
        __slotTakeouts
    };
}));
