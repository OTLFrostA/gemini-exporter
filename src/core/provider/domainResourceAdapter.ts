import type { LegacyResourceHints } from '../export/assets/resourceHints.js';
import type { DomainAsset, DomainAssetKind, DomainMessage } from '../domain/conversationDetail.js';
import type { LegacyAttachmentRecord } from './legacyAttachmentRecord.js';
import { normalizedResourceReference, resolveLegacyAttachmentGroups, type LegacyAttachmentGroup } from './legacyAttachmentAdapter.js';
import { mapContentAssetReferences } from '../content/assetReferences.js';

/** Stable semantic identities do not depend on message order or export numbering. */
function resourceId(key: string): string {
    let first = 0x811c9dc5, second = 0x9e3779b9;
    for (let index = 0; index < key.length; index++) {
        first = Math.imul(first ^ key.charCodeAt(index), 0x01000193);
        second = Math.imul(second ^ key.charCodeAt(index), 0x85ebca6b);
    }
    return `resource-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
function displayName(record: LegacyAttachmentRecord): string | undefined {
    return record.title || record.name || record.fileName;
}
function kindOf(record: LegacyAttachmentRecord): DomainAssetKind {
    const mediaType = (record.mimeType || record.mime || '').toLowerCase();
    if (record.type === 'image' || record.isImage || mediaType.startsWith('image/')
        || /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(displayName(record) ?? '')) return 'image';
    if (mediaType.startsWith('audio/') || record.type === 'audio') return 'audio';
    if (mediaType.startsWith('video/') || record.type === 'video') return 'video';
    return ['file', 'doc', 'code'].includes(record.type) || mediaType ? 'file' : 'other';
}
function identityKey(record: LegacyAttachmentRecord, providerId: string): string | undefined {
    const request = (record.providerRequestId || record.generation?.providerRequestId || '').toLowerCase().replace(/^r_/, '');
    const ordinal = record.imageOrdinal ?? record.generation?.imageOrdinal ?? (record.generation?.imageCount === 1 ? 0 : undefined);
    const chat = (record.generation?.chatId ?? '').replace(/^c_/, '');
    const uri = record.resolvedUrl || record.sourceUrl || record.url || record.src || (/^https?:\/\//i.test(record.localName ?? '') ? record.localName : undefined);
    const location = uri;
    if (request) return JSON.stringify([providerId, 'generation', chat, request, ordinal ?? location ?? null]);
    if (record.generation?.time && record.generation.prompt && ordinal !== undefined) {
        return JSON.stringify([providerId, 'generation', chat, Math.floor(record.generation.time / 1000), record.generation.generationOrdinal, record.generation.prompt.trim(), ordinal]);
    }
    if (record.id && kindOf(record) !== 'image') return JSON.stringify([providerId, 'document', record.id]);
    if (location) return JSON.stringify([providerId, kindOf(record), normalizedResourceReference(location)]);
    // No evidence establishes whether two anonymous missing records are one resource.
    return undefined;
}
function toAsset(record: LegacyAttachmentRecord, id: string): DomainAsset {
    const kind = kindOf(record);
    const name = displayName(record);
    const uri = record.resolvedUrl || record.sourceUrl || record.url || record.src || (/^https?:\/\//i.test(record.localName ?? '') ? record.localName : undefined);
    const mediaType = record.mimeType || record.mime;
    const dataBase64 = record.dataBase64 || record.blobBase64;
    const documentFields = ['id', 'createdAt', 'chipUrl', 'sections', 'links', 'contentMarkdown', 'candidates', 'hasFabricatedText'] as const;
    const document = Object.fromEntries(documentFields.flatMap(field => record[field] !== undefined ? [[field, record[field]]] : []));
    const generation = { ...record.generation,
        ...(!record.generation?.providerRequestId && record.providerRequestId ? { providerRequestId: record.providerRequestId } : {}),
        ...(record.generation?.imageOrdinal === undefined && record.imageOrdinal !== undefined ? { imageOrdinal: record.imageOrdinal } : {}),
    };
    return { id, kind, ...(name ? { name } : {}),
        ...(mediaType ? { mediaType } : {}),
        ...(record.size !== undefined ? { byteLength: record.size } : {}),
        ...(record.width !== undefined || record.height !== undefined ? { dimensions: {
            ...(record.width !== undefined ? { width: record.width } : {}), ...(record.height !== undefined ? { height: record.height } : {}),
        } } : {}),
        ...(uri ? { source: { uri } } : {}),
        ...(dataBase64 ? { dataBase64 } : {}),
        ...(record.failureReason ? { failureReason: record.failureReason } : {}),
        ...(record.source ? { origin: record.source } : {}),
        ...(record.isGenerated !== undefined ? { generated: record.isGenerated } : {}),
        ...(Object.keys(generation).length ? { generation } : {}),
        ...(Object.keys(document).length ? { document } : {}),
    };
}

/** Close every body/reasoning reference over one conversation resource registry before Domain. */
export function closeDomainResources(providerId: string, messages: DomainMessage[], groups: LegacyAttachmentGroup[]): { assets: DomainAsset[]; messages: DomainMessage[]; resourceHints: LegacyResourceHints } {
    const resolved = resolveLegacyAttachmentGroups(groups, { semanticOnly: true });
    const claimedIds = new Set<string>();
    const assets = resolved.attachments.map((record, index) => {
        const key = identityKey(record, providerId);
        const candidate = key ? resourceId(key) : undefined;
        // Conflicting or incomplete evidence must not collapse distinct resources.
        const id = candidate && !claimedIds.has(candidate) ? candidate : resourceId(JSON.stringify([providerId, 'unidentified', index]));
        claimedIds.add(id);
        return toAsset(record, id);
    });
    const resourceHints: Record<string, { archivePath?: string; fallbackName?: string; unresolvedReference?: string }> = {};
    resolved.attachments.forEach((record, index) => {
        if (record.localName && !/^[a-z][a-z\d+.-]*:/i.test(record.localName)) resourceHints[assets[index].id] = {
            archivePath: record.localName, fallbackName: record.localName.split('/').pop(),
        };
    });
    const inline = new Map<string, string>();
    const closed = messages.map((message, groupIndex) => {
        const resolve = (ref: string, kind: 'image' | 'file', alt?: string): string => {
            const index = resolved.findReference(ref, groupIndex);
            if (index !== undefined) return assets[index].id;
            const hasSource = !resolved.isExportAlias(ref, groupIndex);
            const key = JSON.stringify([providerId, 'inline', hasSource ? null : groupIndex, normalizedResourceReference(ref)]);
            const known = inline.get(key);
            if (known) return known;
            const id = resourceId(hasSource ? key : JSON.stringify([providerId, 'unidentified-inline', assets.length]));
            if (claimedIds.has(id)) {
                // The input contains conflicting resources with this source; keep the unresolved reference separate.
                const ambiguousId = `resource-${crypto.randomUUID()}`;
                assets.push({ id: ambiguousId, kind, source: { uri: ref } });
                inline.set(key, ambiguousId);
                return ambiguousId;
            }
            claimedIds.add(id);
            const name = alt?.trim() || (hasSource && !/^data:/i.test(ref) ? (ref.split('/').pop() ?? '').split('?')[0] : undefined);
            assets.push({ id, kind, ...(name ? { name } : {}), ...(hasSource ? { source: { uri: ref } } : {}) });
            if (!hasSource) resourceHints[id] = { unresolvedReference: ref };
            inline.set(key, id);
            return id;
        };
        // Reasoning precedes the body in the existing export presentation.
        const reasoning = message.reasoning && mapContentAssetReferences(message.reasoning, resolve);
        const content = mapContentAssetReferences(message.content, resolve);
        const attachmentIds = resolved.attachmentIndexes[groupIndex].map(index => assets[index].id);
        return { ...message, content, ...(reasoning ? { reasoning } : {}),
            ...(attachmentIds.length || groups[groupIndex].input.attachments ? { attachmentIds } : {}) };
    });
    return { assets, messages: closed, resourceHints };
}
