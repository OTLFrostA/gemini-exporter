import type { DomainAsset } from '../../l2/conversationDetail.js';
import { readConversationKey, type ConversationKey } from '../../l2/conversationKey.js';
import type { SourceConversationParseResult } from '../parsers/parsingResult.js';
import type { ResourceBytes } from '../../shared/resources/resourceResult.js';

type ResourceReader = (signal?: AbortSignal) => Promise<ResourceBytes>;
const conversationIdentity = (key: ConversationKey) => JSON.stringify([key.accountId, key.conversationId]);

/** One acquisition/export task owns this context. Release it in the task's finally block. */
export function createSourceResourceContext() {
    const readers = new Map<string, Map<string, ResourceReader>>();
    let released = false;
    return {
        retain(key: ConversationKey, assetId: string, read: ResourceReader) {
            readConversationKey(key);
            if (released) throw new Error('Resource context released');
            const id = conversationIdentity(key);
            let conversationReaders = readers.get(id);
            if (!conversationReaders) {
                conversationReaders = new Map();
                readers.set(id, conversationReaders);
            }
            conversationReaders.set(assetId, read);
        },
        /** Called only after L2 accepts this entire Detail candidate. Replace, never
         * merge, previous readers: the same assetId may mean different bytes in a
         * later selected snapshot. ZIP-specific readers can be appended with retain(). */
        retainParsed(key: ConversationKey, parsed: SourceConversationParseResult) {
            readConversationKey(key);
            if (released) throw new Error('Resource context released');
            if (key.conversationId !== parsed.conversationId) throw new TypeError('Resource conversation mismatch');
            const selected = new Map<string, ResourceReader>();
            for (const asset of parsed.conversation.detail.assets) {
                const hint = parsed.acquisitionHints[asset.id];
                if (!hint) continue;
                const locator = [hint.url, hint.sourceUrl, hint.resolvedUrl, hint.src].find(uri => uri && /^(https:\/\/|data:)/i.test(uri));
                if (hint.dataBase64 !== undefined) {
                    const encoded = hint.dataBase64;
                    selected.set(asset.id, async () => {
                        const raw = encoded.startsWith('data:') ? encoded.slice(encoded.indexOf(',') + 1) : encoded;
                        const bytes = Uint8Array.from(atob(raw), character => character.charCodeAt(0));
                        return { bytes, mediaType: asset.mediaType ?? hint.mimeType ?? hint.mime };
                    });
                } else if (locator) selected.set(asset.id, signal => acquireSourceResource({ ...asset, sourceUri: locator }, signal));
            }
            readers.set(conversationIdentity(key), selected);
        },
        async acquire(key: ConversationKey, asset: DomainAsset, signal?: AbortSignal, remote?: ResourceReader): Promise<ResourceBytes> {
            readConversationKey(key);
            signal?.throwIfAborted();
            if (released) throw new Error('Resource context released');
            const read = readers.get(conversationIdentity(key))?.get(asset.id);
            let result: ResourceBytes | undefined;
            if (read) {
                try { result = await read(signal); } catch { signal?.throwIfAborted(); }
            }
            signal?.throwIfAborted();
            if (!result?.bytes.byteLength) result = await (remote ? remote(signal) : acquireSourceResource(asset, signal));
            signal?.throwIfAborted();
            if (!result.bytes.byteLength) throw new Error('Empty source resource');
            const mediaType = result.mediaType ?? asset.mediaType, name = result.name ?? asset.name;
            return { ...result, ...(mediaType ? { mediaType } : {}), ...(name ? { name } : {}) };
        },
        /** Folder exports discard already-delivered conversation readers immediately. */
        releaseConversation(key: ConversationKey) {
            readConversationKey(key);
            readers.delete(conversationIdentity(key));
        },
        release() { readers.clear(); released = true; },
    };
}
export type SourceResourceContext = ReturnType<typeof createSourceResourceContext>;

/** Bytes remain acquisition output, never a second Detail field. */
export async function acquireSourceResource(asset: DomainAsset, signal?: AbortSignal): Promise<ResourceBytes> {
    signal?.throwIfAborted();
    if (!asset.sourceUri || !/^(https:\/\/|data:)/i.test(asset.sourceUri)) throw new Error('No supported source locator');
    const response = await fetch(asset.sourceUri, { credentials: 'include', signal });
    if (!response.ok) throw new Error(`Resource request failed: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    if (!bytes.byteLength) throw new Error('Empty source resource');
    const mediaType = asset.mediaType ?? response.headers.get('content-type')?.split(';')[0].trim();
    return { bytes, ...(mediaType ? { mediaType } : {}), ...(asset.name ? { name: asset.name } : {}) };
}
