import { restoreDomainDetail } from '../core/domain/runtimeValidation.js';
import { readConversationKey } from '../core/domain/conversationKey.js';
import { getAccount } from '../core/storage/accountRegistryStore.js';
import { NATIVE_DETAIL_ENVELOPE_VERSION } from '../core/utils/nativeDetailTransport.js';
import { ensureStorageReady } from '../core/storage/schemaMigration.js';
import { getDetail, putDetail, deleteDetail, storageIdentity } from '../core/storage/domain/domainStore.js';
import { encodeBytes, decodeBytes, readStoredAcquisitionHints } from '../core/storage/domain/transport.js';
import { cacheDomainResource, getDomainResource, cacheAcquiredResources, getAcquisitionHints, clearResourceContext } from '../core/storage/domain/resourceContext.js';
import type { StoredDomainResource } from '../core/storage/domain/contracts.js';

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Domain storage request');
    return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string') throw new TypeError('Invalid Domain storage identity'); return value; }

/** Content scripts must use the extension-origin repository, never the host page's IndexedDB. */
export function handleDomainStorageMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (value: unknown) => void): boolean {
    const respond = (value: { ok: boolean; value?: unknown; error?: string }): void => sendResponse({ ...value, domainEnvelopeVersion: NATIVE_DETAIL_ENVELOPE_VERSION });
    if (!message || typeof message !== 'object' || !('action' in message) || message.action !== 'domainStorage') return false;
    if (sender.id !== chrome.runtime.id) { respond({ ok: false, error: 'Foreign Domain storage sender' }); return true; }
    void (async () => {
        try {
            await ensureStorageReady();
            const request = object(message), payload = object(request.payload);
            if (request.command === 'put') {
                const detail = restoreDomainDetail(payload.detail);
                if (!await getAccount(detail.key.accountId)) throw new TypeError('Domain Account missing');
                await putDetail(detail);
                respond({ ok: true }); return;
            }
            if (request.command === 'ready') { respond({ ok: true }); return; }
            if (request.command === 'get' || request.command === 'remove') {
                const key = readConversationKey(payload.key);
                if (request.command === 'get') respond({ ok: true, value: await getDetail(key) });
                else { await deleteDetail(key); await clearResourceContext({ providerId: 'unused', ...key }); respond({ ok: true }); }
                return;
            }
            const rawIdentity = object(payload.identity);
            const identity = storageIdentity(text(rawIdentity.providerId), text(rawIdentity.accountId), text(rawIdentity.conversationId));
            if (request.command === 'clearResources') { await clearResourceContext(identity); respond({ ok: true }); return; }
            if (request.command === 'cache') { await cacheDomainResource(identity, text(payload.assetId), text(payload.sourceUri), decodeBytes(payload.bytes)); respond({ ok: true }); return; }
            if (request.command === 'hints') { respond({ ok: true, value: await getAcquisitionHints(identity) }); return; }
            if (request.command === 'acquired') {
                if (!Array.isArray(payload.resources)) throw new TypeError('Invalid transported resources');
                const resources: StoredDomainResource[] = payload.resources.map(value => {
                    const item = object(value);
                    return { assetId: text(item.assetId), bytes: decodeBytes(item.bytes), ...(typeof item.sourcePath === 'string' ? { sourcePath: item.sourcePath } : {}) };
                });
                // Reuse the Domain validator for the asset-only transport shape; no body revalidation.
                const assets = restoreDomainDetail({ key: { accountId: identity.accountId, conversationId: identity.conversationId },
                    quality: { status: 'unknown' }, messages: [], assets: payload.assets }).assets;
                await cacheAcquiredResources(identity, assets, readStoredAcquisitionHints(payload.hints), resources);
                respond({ ok: true }); return;
            }
            if (request.command === 'resource') { const bytes = await getDomainResource(identity, text(payload.assetId)); respond({ ok: true, value: bytes ? encodeBytes(bytes) : null }); return; }
            throw new TypeError('Unknown Domain storage command');
        } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    })();
    return true;
}
