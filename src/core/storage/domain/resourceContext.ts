import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import type { ResourceAcquisitionHints } from '../../resources/resourceAcquisition.js';
import { decodeDataUrl } from '../../export/assets/dataUrl.js';
import { matchResourceSets, resourceIdentity } from '../../parsers/shared/resources/resourceIdentity.js';
import { domainStorageKey, getDetail } from './domainStore.js';
import type { DomainStorageIdentity, StoredDomainResource } from './contracts.js';
import { needsDomainBroker, callDomainBroker, encodeBytes, decodeBytes, readStoredAcquisitionHints } from './transport.js';

interface ResourceContext { assets: DomainConversationDetail['assets']; hints: ResourceAcquisitionHints; resources: StoredDomainResource[] }
// Transitional: no job-end cleanup. Acquisition / Export must own and release this
// context; see docs/domain-storage.md, Pending cross-module task.
const contexts = new Map<string, ResourceContext>();
// Extension pages share the background execution context with content-script acquisition.
function useResourceBroker(): boolean {
    return needsDomainBroker() || (typeof chrome !== 'undefined' && !!chrome.runtime?.id && typeof document !== 'undefined');
}
export async function clearResourceContext(identity?: DomainStorageIdentity): Promise<void> {
    if (identity && useResourceBroker()) { await callDomainBroker('clearResources', { identity }); return; }
    if (identity) contexts.delete(domainStorageKey(identity)); else contexts.clear();
}
/** Bytes and temporary locators last only for the current extension execution. */
export async function cacheAcquiredResources(identity: DomainStorageIdentity, assets: DomainConversationDetail['assets'],
    hints: ResourceAcquisitionHints = {}, resources: readonly StoredDomainResource[] = []): Promise<void> {
    const incoming = [...resources];
    const sourceHints = readStoredAcquisitionHints(hints);
    for (const asset of assets) {
        if (incoming.some(r => r.assetId === asset.id)) continue;
        const hint = hints[asset.id];
        const uri = hint?.dataBase64 ? `data:${asset.mediaType ?? 'application/octet-stream'};base64,${hint.dataBase64}`
            : [hint?.url, hint?.sourceUrl].find(url => url?.startsWith('data:'));
        if (uri) { const value = decodeDataUrl(uri); if (value.ok && value.bytes.length) incoming.push({ assetId: asset.id, bytes: value.bytes }); }
    }
    if (incoming.some(r => !(r.bytes instanceof Uint8Array) || !r.bytes.length || !assets.some(a => a.id === r.assetId))) throw new TypeError('Invalid acquired resource binding');
    if (useResourceBroker()) {
        await callDomainBroker('acquired', { identity, assets, hints: sourceHints, resources: incoming.map(r => ({ ...r, bytes: encodeBytes(r.bytes) })) }); return;
    }
    const selected = await getDetail(identity);
    if (!selected) throw new TypeError('Acquired resources require a saved Detail');
    const old = contexts.get(domainStorageKey(identity));
    const next: ResourceContext = { assets: selected.assets, hints: {}, resources: [] };
    const targets = selected.assets.map(a => resourceIdentity(a, identity.conversationId));
    // Retained bytes win. A rejected body can fill only independently matched missing bytes.
    for (const source of [...(old ? [old] : []), { assets, hints: sourceHints, resources: incoming }]) {
        for (const match of matchResourceSets(identity.conversationId, targets, source.assets.map(a => resourceIdentity(a, identity.conversationId)))) {
            const target = selected.assets[match.target], asset = source.assets[match.source];
            const resource = source.resources.find(r => r.assetId === asset.id);
            if (resource && !next.resources.some(r => r.assetId === target.id)) next.resources.push({ ...resource, assetId: target.id, bytes: resource.bytes.slice() });
            if (source.hints[asset.id] && !next.hints[target.id]) next.hints = { ...next.hints, [target.id]: structuredClone(source.hints[asset.id]) };
        }
    }
    contexts.set(domainStorageKey(identity), next);
}
export async function getAcquisitionHints(identity: DomainStorageIdentity): Promise<ResourceAcquisitionHints> {
    if (useResourceBroker()) return readStoredAcquisitionHints(await callDomainBroker('hints', { identity }));
    return structuredClone(contexts.get(domainStorageKey(identity))?.hints ?? {});
}
export async function getDomainResource(identity: DomainStorageIdentity, assetId: string): Promise<Uint8Array | null> {
    if (useResourceBroker()) { const value = await callDomainBroker('resource', { identity, assetId }); return value === null ? null : decodeBytes(value); }
    const detail = await getDetail(identity), context = contexts.get(domainStorageKey(identity));
    if (!detail || !context) return null;
    const target = detail.assets.find(a => a.id === assetId);
    if (!target) return null;
    const matches = matchResourceSets(identity.conversationId, [resourceIdentity(target, identity.conversationId)], context.assets.map(a => resourceIdentity(a, identity.conversationId)));
    const source = matches.length === 1 ? context.assets[matches[0].source] : null;
    return context.resources.find(r => r.assetId === source?.id)?.bytes.slice() ?? null;
}
export async function cacheDomainResource(identity: DomainStorageIdentity, assetId: string, sourceUri: string, bytes: Uint8Array): Promise<void> {
    if (useResourceBroker()) { await callDomainBroker('cache', { identity, assetId, sourceUri, bytes: encodeBytes(bytes) }); return; }
    const detail = await getDetail(identity);
    if (detail?.assets.find(a => a.id === assetId)?.sourceUri !== sourceUri) return;
    const context = contexts.get(domainStorageKey(identity));
    if (context) context.resources = context.resources.filter(r => r.assetId !== assetId);
    await cacheAcquiredResources(identity, detail.assets, {}, [{ assetId, bytes }]);
}
