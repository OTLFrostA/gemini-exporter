import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { findResourceMatch, resourceIdentity, type ResourceIdentity } from '../../parsers/shared/resources/resourceIdentity.js';
import type {
    GeneratedMediaIdentity
} from '../../../types/conversation.js';
import { normId as utilsNormId } from "../../utils/utils.js";

interface TakeoutMediaFile {
    name?: string;
    path?: string;
    async?: (type: 'uint8array') => Promise<unknown>;
}

interface StoredTakeoutMedia {
    filename: string;
    fileObj?: TakeoutMediaFile;
    generation?: GeneratedMediaIdentity;
    imageOrdinal?: number;
    isGenerated?: boolean;
    providerRequestId?: string;
}

/** Source identity used to recover bytes; export destinations never belong here. */
export interface TakeoutResourceLookup {
    assetId: string;
    sourceUri?: string;
    generation?: GeneratedMediaIdentity;
}

export type TakeoutCachedConversation = ResourceConversationParseResult;

export interface TakeoutStore {
    mediaMap: Record<string, StoredTakeoutMedia[]>;
    globalMedia: Record<string, TakeoutMediaFile>;
    convCache: Record<string, TakeoutCachedConversation>;
}

interface MediaIndexModule {
    getStore: (slot?: string | null) => TakeoutStore;
    normId: (id?: string | null) => string;
    extractC2PATimestamp: (bufferOrArray: unknown) => number | null;
    getTakeoutOfflineChat: (chatId: string, slot?: string | null) => TakeoutCachedConversation | null;
    getTakeoutMediaForChat: (chatId: string, slot?: string | null) => StoredTakeoutMedia[];
    getTakeoutFallbackMedia: (chatId: string, lookup: TakeoutResourceLookup, slot?: string | null) => Promise<Uint8Array | null>;
    commitTakeoutData: (slot: string | null | undefined, data: Partial<TakeoutStore>) => void;
    clearTakeoutData: (slot?: string | null) => void;
    __slotTakeouts: Map<string, TakeoutStore>;
}

const __slotTakeouts = new Map<string, TakeoutStore>();

function normSlot(slot?: string | null): string {
    return (slot && typeof slot === 'string' && slot.trim()) ? slot.trim() : 'u0';
}

export function getStore(slot?: string | null): TakeoutStore {
    const s = normSlot(slot);
    const existing = __slotTakeouts.get(s);
    if (existing) {
        return existing;
    }
    return { mediaMap: {}, globalMedia: {}, convCache: {} };
}

export const normId = utilsNormId;

async function readTakeoutBytes(file?: TakeoutMediaFile | null): Promise<Uint8Array | null> {
    if (!file || typeof file.async !== 'function') return null;
    const res = await file.async('uint8array');
    if (res instanceof Uint8Array && res.length > 0) {
        return res;
    }
    return null;
}

function extractC2PATimestamp(bufferOrArray: unknown): number | null {
    if (!bufferOrArray) return null;
    let str = '';
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bufferOrArray)) {
        str = bufferOrArray.toString('utf8', 0, Math.min(bufferOrArray.length, 65536));
    } else if (ArrayBuffer.isView(bufferOrArray)) {
        const len = Math.min(bufferOrArray.byteLength, 65536);
        const view = new Uint8Array(bufferOrArray.buffer, bufferOrArray.byteOffset, len);
        str = new TextDecoder('utf-8', { fatal: false }).decode(view);
    } else if (typeof bufferOrArray === 'string') {
        str = bufferOrArray.slice(0, 65536);
    } else {
        return null;
    }
    const m = /(20\d{2})([01]\d)([0-3]\d)([0-2]\d)([0-5]\d)([0-5]\d)Z/.exec(str);
    if (!m || m.index === undefined) return null;
    // Require a trust marker near candidate timestamp to prevent false positives
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
    if (month < 1 || month > 12 || day < 1 || day > 31 ||
        hour > 23 || min > 59 || sec > 60) return null;
    const t = Date.UTC(year, month - 1, day, hour, min, sec);
    const d = new Date(t);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        return null;
    }
    return t;
}

function getTakeoutOfflineChat(chatId: string, slot?: string | null): TakeoutCachedConversation | null {
    if (!chatId) return null;
    const nid = normId(chatId);
    return getStore(slot).convCache[nid] || null;
}

function getTakeoutMediaForChat(chatId: string, slot?: string | null): StoredTakeoutMedia[] {
    if (!chatId) return [];
    const nid = normId(chatId);
    const store = getStore(slot);
    return (store.mediaMap && store.mediaMap[nid]) || [];
}

async function getTakeoutFallbackMedia(chatId: string, lookup: TakeoutResourceLookup, slot?: string | null): Promise<Uint8Array | null> {
    if (!lookup || (!lookup.assetId && !lookup.sourceUri && !lookup.generation)) return null;
    const nid = normId(chatId);
    if (!nid || (lookup.generation && normId(lookup.generation.chatId) !== nid)) return null;
    const store = getStore(slot);
    if (!store.convCache[nid] && Object.keys(store.convCache).length > 0) return null;
    const requested: ResourceIdentity = { assetId: lookup.assetId, sourceUris: lookup.sourceUri ? [lookup.sourceUri] : [], generation: lookup.generation };
    const native = store.convCache[nid];
    if (native) {
        const candidates = native.conversation.assets.map(asset => ({ ...resourceIdentity(asset), sourceUris:
            [asset.source?.uri, native.acquisitionHints[asset.id]?.url, native.acquisitionHints[asset.id]?.sourceUrl,
                native.resourceHints[asset.id]?.archivePath].filter((uri): uri is string => !!uri) }));
        const match = findResourceMatch(nid, requested, candidates);
        if (match === null) return null;
        const path = native.resourceHints[native.conversation.assets[match].id]?.archivePath;
        try { return await readTakeoutBytes(path ? store.globalMedia[path] : undefined); } catch { return null; }
    }
    const media = store.mediaMap[nid] || [];
    const match = findResourceMatch(nid, requested, media.map(item => ({ assetId: '', generation: item.generation,
        sourceUris: [item.filename, item.fileObj?.name, item.fileObj?.path].filter((uri): uri is string => !!uri) })));
    if (match === null) return null;
    try { return await readTakeoutBytes(media[match].fileObj); } catch { return null; }
}

function commitTakeoutData(slot: string | null | undefined, data: Partial<TakeoutStore>): void {
    const s = normSlot(slot);
    __slotTakeouts.set(s, {
        mediaMap: data.mediaMap || {},
        globalMedia: data.globalMedia || {},
        convCache: data.convCache || {}
    });
}

function clearTakeoutData(slot?: string | null): void {
    if (slot) {
        __slotTakeouts.delete(normSlot(slot));
    } else {
        __slotTakeouts.clear();
    }
}

export {
    extractC2PATimestamp,
    getTakeoutOfflineChat,
    getTakeoutMediaForChat,
    getTakeoutFallbackMedia,
    commitTakeoutData,
    clearTakeoutData,
    readTakeoutBytes,
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

export default MediaIndex;
