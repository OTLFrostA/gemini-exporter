import { isDurableSourceUri } from '../../../l2/sourceUri.js';
import type { DomainAsset } from '../../../l2/conversationDetail.js';
import type { ImageInline } from '../../../l2/content/inline.js';
import type { ResourceAcquisitionHint } from '../../resources/resourceAcquisition.js';
import { grokObject } from './source.js';

/** Translate upstream resource records to the existing Domain registry, never inline bytes. */
export function grokResources(assets: DomainAsset[], hints: Record<string, ResourceAcquisitionHint>, warn: (code: string, message: string) => void) {
    let inlineCounter = 0;
    function resolveHttpsUrl(candidate: string, allowRelativePath: boolean): string | undefined {
        try {
            const url = allowRelativePath && candidate.startsWith('/')
                ? new URL(candidate, 'https://grok.com')
                : new URL(candidate);
            if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
        } catch { /* An unavailable locator is reported below. */ }
        return undefined;
    }
    function add(raw: unknown, messageId: string, ordinal: number, kind: 'image' | 'file'): string | null {
        const row = grokObject(raw);
        const embedded = row.embedded_image ? grokObject(row.embedded_image) : null;
        const data = typeof embedded?.data === 'string' ? embedded.data : undefined;
        const candidate = typeof row.url === 'string' && row.url ? row.url : undefined;
        const uri = candidate ? resolveHttpsUrl(candidate, true) : undefined;
        if (!uri && !data) { warn('grok.resource.unavailable', 'Grok attachment has no downloadable locator'); return null; }
        const id = 'grok:' + messageId + ':' + kind + ':' + ordinal;
        const name = typeof row.file_name === 'string' ? row.file_name : kind;
        const generation = row.generation && typeof row.generation === 'object' ? grokObject(row.generation) : null;
        const normalizedGeneration = generation ? {
            ...(typeof generation.providerRequestId === 'string' ? { providerRequestId: generation.providerRequestId } : {}),
            ...(typeof generation.prompt === 'string' ? { prompt: generation.prompt } : {}),
            ...(typeof generation.imageOrdinal === 'number' && Number.isFinite(generation.imageOrdinal)
                ? { imageOrdinal: generation.imageOrdinal } : {}),
        } : null;
        const mediaType = typeof row.file_type === 'string' && row.file_type ? row.file_type : undefined;
        assets.push({ id, kind, name,
            ...(normalizedGeneration && Object.keys(normalizedGeneration).length ? { generation: normalizedGeneration } : {}),
            ...(mediaType ? { mediaType } : {}),
            ...(uri && isDurableSourceUri(uri) ? { sourceUri: uri } : {}) });
        hints[id] = { ...(data ? { dataBase64: data } : {}), ...(uri ? { url: uri } : {}), ...(mediaType ? { mimeType: mediaType } : {}) };
        return id;
    }
    return {
        blocks(message: Record<string, unknown>, id: string): { attachmentIds: string[] } {
            const attachmentIds: string[] = [];
            for (const [kind, values] of [['image', message.images], ['file', message.attachments]] as const) {
                if (!Array.isArray(values)) continue;
                values.forEach((value, ordinal) => {
                    const assetId = add(value, id, ordinal, kind);
                    if (!assetId) return;
                    attachmentIds.push(assetId);
                });
            }
            return { attachmentIds };
        },
        image(ref: string, alt: string, messageId: string): ImageInline {
            const id = `grok:${messageId}:inline:${inlineCounter++}`;
            const uri = ref ? resolveHttpsUrl(ref, true) : undefined;
            if (!uri) {
                warn('grok.resource.unavailable', 'Grok Markdown image has no downloadable HTTPS locator');
                assets.push({ id, kind: 'image', name: alt || 'image' });
                return { type: 'image', assetId: id, ...(alt ? { alt } : {}) };
            }
            assets.push({
                id,
                kind: 'image',
                name: alt || 'image',
                ...(isDurableSourceUri(uri) ? { sourceUri: uri } : {}),
            });
            hints[id] = { url: uri };
            return { type: 'image', assetId: id, ...(alt ? { alt } : {}) };
        },
    };
}
