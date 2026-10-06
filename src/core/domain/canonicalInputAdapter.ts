import type { DomainAsset, DomainMessage } from './conversationDetail.js';
import type { CanonicalMessageInput } from '../export/canonical/messageInput.js';
import type { AssetNormalizationInput } from '../export/canonical/assetInput.js';
import { mapContentAssetReferences } from '../content/assetReferences.js';

/** Translate semantic resource metadata into the existing export input, without provider parsing. */
function exportResource(asset: DomainAsset): AssetNormalizationInput {
    return {
        referenceId: asset.id,
        type: asset.kind,
        name: asset.name,
        mimeType: asset.mediaType,
        size: asset.byteLength,
        width: asset.dimensions?.width,
        height: asset.dimensions?.height,
        localName: asset.source?.path,
        resolvedUrl: asset.source?.uri,
        dataBase64: asset.dataBase64,
        contentMarkdown: asset.document?.contentMarkdown,
        failureReason: asset.failureReason,
    };
}

/** Domain references are closed over the registry; reasoning and body are already Content AST. */
export function toCanonicalDomainMessage(message: DomainMessage, locator: string, assets: ReadonlyMap<string, DomainAsset>): CanonicalMessageInput {
    const lookup = (id: string): DomainAsset => {
        const asset = assets.get(id);
        if (!asset) throw new TypeError(`Unregistered Domain resource: ${id}`);
        return asset;
    };
    const attachments = (message.attachmentIds ?? []).map(id => exportResource(lookup(id)));
    const attached = new Set(message.attachmentIds);
    const inlineAssetSources = new Map<string, string>();
    const resolve = (ref: string, kind: 'image' | 'file'): string => {
        const asset = lookup(ref);
        if (attached.has(ref)) return ref;
        // Preserve the existing inline export path and numbering for URI-only resources.
        if (kind === 'image' && !asset.source?.path && !asset.dataBase64 && !asset.mediaType
            && asset.byteLength === undefined && !asset.dimensions && !asset.failureReason && !asset.document) {
            inlineAssetSources.set(ref, asset.source?.uri ?? '');
            return ref;
        }
        attachments.push(exportResource(asset));
        attached.add(ref);
        return ref;
    };
    const reasoningBlocks = message.reasoning && mapContentAssetReferences(message.reasoning, resolve);
    const content = mapContentAssetReferences(message.content, resolve);
    const { id, role, timestamp, groundingCitationMarkers } = message;
    return {
        message: { id, role, content, timestamp, attachments, groundingCitationMarkers },
        locator,
        reasoningBlocks,
        inlineAssetSources,
        citationInput: { list: message.citations ?? [], skipped: 0 },
    };
}
