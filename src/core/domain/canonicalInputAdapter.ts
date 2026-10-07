import type { LegacyResourceHint, LegacyResourceHints } from '../export/assets/resourceHints.js';
import type { DomainAsset, DomainMessage } from './conversationDetail.js';
import type { CanonicalMessageInput } from '../export/canonical/messageInput.js';
import type { AssetNormalizationInput } from '../export/canonical/assetInput.js';
import { mapContentAssetReferences } from '../content/assetReferences.js';

/** Translate semantic resource metadata into the existing export input, without provider parsing. */
function exportResource(asset: DomainAsset, hint?: LegacyResourceHint): AssetNormalizationInput {
    return {
        referenceId: asset.id,
        type: asset.kind,
        name: asset.name ?? hint?.fallbackName,
        mimeType: asset.mediaType,
        size: asset.byteLength,
        width: asset.dimensions?.width,
        height: asset.dimensions?.height,
        localName: hint?.archivePath,
        resolvedUrl: asset.source?.uri,
        dataBase64: asset.dataBase64,
        contentMarkdown: asset.document?.contentMarkdown,
        failureReason: asset.failureReason,
    };
}

/** Domain references are closed over the registry; reasoning and body are already Content AST. */
export function toCanonicalDomainMessage(message: DomainMessage, locator: string, assets: ReadonlyMap<string, DomainAsset>, hints: LegacyResourceHints = {}): CanonicalMessageInput {
    const lookup = (id: string): DomainAsset => {
        const asset = assets.get(id);
        if (!asset) throw new TypeError(`Unregistered Domain resource: ${id}`);
        return asset;
    };
    const attachments = (message.attachmentIds ?? []).map(id => exportResource(lookup(id), hints[id]));
    const attached = new Set(message.attachmentIds);
    const inlineAssetSources = new Map<string, string>();
    const resolve = (ref: string, kind: 'image' | 'file'): string => {
        const asset = lookup(ref);
        if (attached.has(ref)) return ref;
        // Preserve the existing inline export path and numbering for URI-only resources.
        if (kind === 'image' && !hints[ref]?.archivePath && !asset.dataBase64 && !asset.mediaType
            && asset.byteLength === undefined && !asset.dimensions && !asset.failureReason && !asset.document) {
            inlineAssetSources.set(ref, asset.source?.uri ?? hints[ref]?.unresolvedReference ?? '');
            return ref;
        }
        attachments.push(exportResource(asset, hints[ref]));
        attached.add(ref);
        return ref;
    };
    const reasoningBlocks = message.reasoning && mapContentAssetReferences(message.reasoning, resolve);
    const content = mapContentAssetReferences(message.content, resolve);
    const { id, role, timestamp } = message;
    const messageId = id ?? `msg-${Number(locator.match(/\[(\d+)\]$/)?.[1] ?? 0)}`;
    const webCitations = (message.citations ?? []).filter(citation => citation.kind !== 'attachment');
    const grounding = (message.citations ?? []).filter(citation => citation.kind === 'attachment');
    const citationIds = new Map((message.citations ?? []).map(citation => [citation.id, citation.kind === 'attachment'
        ? `${messageId}-gcit-${citation.number ?? 1}` : `${messageId}-cit${webCitations.indexOf(citation)}`]));
    const remapCitations = (nodes: import('../content/blocks.js').BlockNode[]) => {
        if (!citationIds.size) return nodes;
        const cloned = structuredClone(nodes);
        const walk = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) { value.forEach(walk); return; }
            const node = value as Record<string, unknown>;
            if (node.type === 'citationRef' && typeof node.citationId === 'string') node.citationId = citationIds.get(node.citationId) ?? node.citationId;
            Object.values(node).forEach(walk);
        };
        walk(cloned); return cloned;
    };
    const resolvedCitations: import('../export/canonical/citations.js').Citation[] = [
        ...webCitations.map((citation, index) => ({ id: `${messageId}-cit${index}`, kind: /^https?:\/\//i.test(citation.url ?? '') ? 'web' as const : 'other' as const, url: citation.url, title: citation.title })),
        ...grounding.map(citation => ({ id: `${messageId}-gcit-${citation.number ?? 1}`, kind: 'attachment' as const })),
    ];
    return {
        message: { id, role, content: remapCitations(content), timestamp, attachments },
        locator,
        reasoningBlocks: reasoningBlocks && remapCitations(reasoningBlocks),
        inlineAssetSources,
        resolvedCitations,
        citationInput: { list: [], skipped: 0 },
    };
}
