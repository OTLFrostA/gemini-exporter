import { ensureStorageReady } from '../core/storage/schemaMigration.js';
import { getStoredDomain, saveDomainConversation, cacheDomainResource, getDomainResource, removeStoredDomain, backupLegacyValue, storageIdentity } from '../core/storage/domain/domainStore.js';
import { encodeDomainRecord, encodeBytes, decodeBytes } from '../core/storage/domain/transport.js';
import type { ResourceConversationParseResult } from '../core/parsers/parsingResult.js';
import type { StoredDomainResource } from '../core/storage/domain/contracts.js';

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Domain storage request');
    return value as Record<string, unknown>;
}
function text(value: unknown): string { if (typeof value !== 'string') throw new TypeError('Invalid Domain storage identity'); return value; }

/** Content scripts must use the extension-origin repository, never the host page's IndexedDB. */
export function handleDomainStorageMessage(message: unknown, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void): boolean {
    if (!message || typeof message !== 'object' || !('action' in message) || message.action !== 'domainStorage') return false;
    if (sender.id !== chrome.runtime.id) { respond({ ok: false, error: 'Foreign Domain storage sender' }); return true; }
    void (async () => {
        try {
            await ensureStorageReady();
            const request = object(message), payload = object(request.payload);
            if (request.command === 'save') {
                const raw = object(payload.parsed);
                const parsed = { conversation: raw.conversation, acquisitionHints: object(raw.acquisitionHints), resourceHints: {}, diagnostics: [] } as ResourceConversationParseResult;
                const resources: StoredDomainResource[] = Array.isArray(payload.resources) ? payload.resources.map(value => {
                    const item = object(value);
                    return { assetId: text(item.assetId), bytes: decodeBytes(item.bytes), ...(typeof item.sourcePath === 'string' ? { sourcePath: item.sourcePath } : {}) };
                }) : [];
                const record = await saveDomainConversation(text(payload.accountSlot), parsed, resources, payload.migration === true);
                respond({ ok: true, value: record ? encodeDomainRecord(record) : null }); return;
            }
            if (request.command === 'backup') {
                await backupLegacyValue(text(payload.key), payload.value);
                respond({ ok: true }); return;
            }
            const rawIdentity = object(payload.identity);
            const identity = storageIdentity(text(rawIdentity.providerId), text(rawIdentity.accountSlot), text(rawIdentity.conversationId));
            if (request.command === 'cache') { await cacheDomainResource(identity, text(payload.assetId), text(payload.sourceUri), decodeBytes(payload.bytes)); respond({ ok: true }); return; }
            if (request.command === 'get') { const record = await getStoredDomain(identity); respond({ ok: true, value: record ? encodeDomainRecord(record) : null }); return; }
            if (request.command === 'resource') { const bytes = await getDomainResource(identity, text(payload.assetId)); respond({ ok: true, value: bytes ? encodeBytes(bytes) : null }); return; }
            if (request.command === 'remove') { await removeStoredDomain(identity); respond({ ok: true }); return; }
            throw new TypeError('Unknown Domain storage command');
        } catch (error) { respond({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
    })();
    return true;
}
