import { normId as utilsNormId } from "../../utils/utils.js";

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

const __slotTakeouts = new Map<string, TakeoutStore>();
let __takeoutMediaMap: Record<string, any> = {};
let __takeoutGlobalMedia: Record<string, any> = {};
let __takeoutConvCache: Record<string, any> = {};

export function getStore(slot?: string | null): TakeoutStore {
    if (slot && __slotTakeouts.has(slot)) {
        return __slotTakeouts.get(slot)!;
    }
    if (slot) {
        // P1-113: an explicit slot that never imported Takeout must NOT fall
        // back to another slot's data (cross-account contamination). Return an
        // empty isolated store instead.
        return { mediaMap: {}, globalMedia: {}, convCache: {} };
    }
    return {
        mediaMap: __takeoutMediaMap,
        globalMedia: __takeoutGlobalMedia,
        convCache: __takeoutConvCache
    };
}

export const normId = utilsNormId;

    function extractC2PATimestamp(bufferOrArray: any): number | null {
        if (!bufferOrArray) return null;
        let str = '';
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bufferOrArray)) {
            // P1-117: decode the first 64KB in one shot instead of 65536× `+=`.
            str = bufferOrArray.toString('utf8', 0, Math.min(bufferOrArray.length, 65536));
        } else if (bufferOrArray instanceof Uint8Array || ArrayBuffer.isView(bufferOrArray)) {
            const byteLen = (bufferOrArray as any).byteLength ?? (bufferOrArray as any).length ?? 0;
            const len = Math.min(byteLen, 65536);
            const view = new Uint8Array((bufferOrArray as any).buffer || bufferOrArray, (bufferOrArray as any).byteOffset || 0, len);
            str = new TextDecoder('utf-8', { fatal: false }).decode(view);
        } else if (typeof bufferOrArray === 'string') {
            str = bufferOrArray.slice(0, 65536);
        } else {
            return null;
        }
        const m = /(20\d{2})([01]\d)([0-3]\d)([0-2]\d)([0-5]\d)([0-5]\d)Z/.exec(str);
        if (!m || m.index === undefined) return null;
        // P1-117: a bare 15-digit run is not a C2PA timestamp. Require a trust
        // marker (C2PA/JUMBF/XMP/EXIF) near the candidate, otherwise any random
        // digit run in the binary would be misread as a capture time.
        const windowStart = Math.max(0, m.index - 512);
        const near = str.slice(windowStart, m.index + 32);
        if (!/(c2pa|jumb|jxmp|xmp|dc:|exif|tiff|createDate|dateTimeOriginal|claim_generator)/i.test(near)) {
            return null;
        }
        const year = parseInt(m[1], 10);
        const month = parseInt(m[2], 10);
        const day = parseInt(m[3], 10);
        const hour = parseInt(m[4], 10);
        const min = parseInt(m[5], 10);
        const sec = parseInt(m[6], 10);
        // P1-117: validate the calendar date instead of letting Date.UTC
        // silently normalize overflows (e.g. month 13 → next year).
        if (month < 1 || month > 12 || day < 1 || day > 31 ||
            hour > 23 || min > 59 || sec > 60) return null;
        const t = Date.UTC(year, month - 1, day, hour, min, sec);
        const d = new Date(t);
        if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
            return null;
        }
        return t;
    }

    function getTakeoutOfflineChat(chatId: string, slot?: string | null): any {
        if (!chatId) return null;
        const nid = normId(chatId);
        // P1-113: getStore already resolves slot → isolated store or legacy
        // globals; no extra global fallback here (that was the leak).
        return getStore(slot).convCache[nid] || null;
    }

    function getTakeoutMediaForChat(chatId: string, slot?: string | null): any[] {
        if (!chatId) return [];
        const nid = normId(chatId);
        const store = getStore(slot);
        return (store.mediaMap && store.mediaMap[nid]) || [];
    }

    async function getTakeoutFallbackMedia(chatId: string, filenameOrId: string, slot?: string | null): Promise<Uint8Array | null> {
        if (!filenameOrId) return null;
        const nid = normId(chatId);
        const store = getStore(slot);
        // P1-113: no silent fallback to the module-global maps — for an
        // explicit slot that never imported, these are empty by design.
        const mediaMap = store.mediaMap;
        const globalMedia = store.globalMedia;
        const isGenericName = (s: string) => /^(?:image(?:[_-]?\d+)?|file(?:[_-]?\d+)?|asset(?:[_-]?\d+)?|media(?:[_-]?\d+)?|thumb(?:nail)?(?:[_-]?\d+)?|photo(?:[_-]?\d+)?|picture(?:[_-]?\d+)?|screenshot(?:[_-]?\d+)?)$/i.test(s);

        let target = String(filenameOrId).replace(/^.*[\\\/]/, '').trim();
        try { target = decodeURIComponent(target); } catch { /* intentional */ }
        let targetStem = target.replace(/\.[^/.]+$/, '').toLowerCase();
        let cleanTarget = target.replace(/^[0-9a-fA-F]{4,16}_+/, '').trim();
        let cleanTargetStem = targetStem.replace(/^[0-9a-fA-F]{4,16}_+/, '').trim();
        // Do NOT strip hash if the stem would collapse into a generic word like 'image' or 'file'!
        if (!isGenericName(cleanTargetStem)) {
            const stripped = cleanTargetStem.replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
            if (!isGenericName(stripped)) {
                cleanTargetStem = stripped;
            }
        }

        const convMedia = mediaMap[nid];
        if (convMedia && convMedia.length) {
            // Pass 1: Exact match pass across all items in conversation media
            for (const item of convMedia) {
                const itemFilename = item.filename;
                const itemStem = itemFilename.replace(/\.[^/.]+$/, '').toLowerCase();
                if (itemFilename === target || itemFilename === cleanTarget || itemStem === targetStem || itemStem === cleanTargetStem) {
                    try {
                        const bin = await item.fileObj.async('uint8array');
                        if (bin && bin.length > 0) return bin;
                    } catch (e) {
                        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e);
                    }
                }
            }

            // Pass 2: stem matching (ONLY for distinctive non-generic names).
            // P1-112: the old substring clauses
            // (cleanTargetStem.includes(cleanItemStem) etc.) could return an
            // UNRELATED file's bytes (e.g. target "cat-photo" hitting an
            // unrelated "photo"), which was then saved under the failed
            // attachment's name — silent content corruption. Only exact stem
            // equality is trusted now; a miss returns null instead of a lie.
            for (const item of convMedia) {
                const itemFilename = item.filename;
                const itemStem = itemFilename.replace(/\.[^/.]+$/, '').toLowerCase();
                let cleanItemStem = itemStem.replace(/^[0-9a-fA-F]{4,16}_+/, '').trim();
                if (!isGenericName(cleanItemStem)) {
                    const stripped = cleanItemStem.replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
                    if (!isGenericName(stripped)) {
                        cleanItemStem = stripped;
                    }
                }

                if (!isGenericName(cleanItemStem) && !isGenericName(cleanTargetStem) && !isGenericName(itemStem) && !isGenericName(targetStem)) {
                    if (cleanItemStem === cleanTargetStem || cleanItemStem === targetStem || itemStem === cleanTargetStem) {
                        try {
                            const bin = await item.fileObj.async('uint8array');
                            if (bin && bin.length > 0) return bin;
                        } catch (e) {
                            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e);
                        }
                    }
                }
            }

            // Pass 3: Single-media fallback (if the conversation has EXACTLY ONE media item and target is generic)
            if (convMedia.length === 1 && (isGenericName(cleanTargetStem) || isGenericName(targetStem))) {
                try {
                    const bin = await convMedia[0].fileObj.async('uint8array');
                    if (bin && bin.length > 0) return bin;
                } catch (e) {
                    if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:mediaIndex.js]', e);
                }
            }
        }

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
                // P1-112: same as pass 2 — no substring matching here either.
                // Only exact stem equality may return another file's bytes.
                if (!isGenericName(cleanStem) && !isGenericName(cleanTargetStem) &&
                    (cleanStem === cleanTargetStem || stem === targetStem)) {
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

export {
    extractC2PATimestamp,
    getTakeoutOfflineChat,
    getTakeoutMediaForChat,
    getTakeoutFallbackMedia,
    commitTakeoutData,
    clearTakeoutData,
    __slotTakeouts
};

export const MediaIndex: MediaIndexModule = {
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

(MediaIndex as any).MediaIndex = MediaIndex;
(MediaIndex as any).default = MediaIndex;

if (typeof globalThis !== 'undefined' && !(globalThis as any).MediaIndex) {
    (globalThis as any).MediaIndex = MediaIndex;
}
if (typeof module === 'object' && module.exports) {
    module.exports = MediaIndex;
}
export default MediaIndex;
