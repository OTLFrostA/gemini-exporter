import type { DomainConversationDetail } from './conversationDetail.js';
import { mapContentAssetReferences } from './content/assetReferences.js';

/** Domain is a closed, JSON-portable semantic graph; invalid references never reach exporters. */
export function assertDomainClosure(conversation: DomainConversationDetail): void {
    const assets = new Set<string>();
    for (const asset of conversation.assets) {
        if (typeof asset.id !== 'string' || !asset.id || assets.has(asset.id)) throw new TypeError(`Duplicate or empty Domain asset identity: ${asset.id}`);
        assets.add(asset.id);
    }
    const quality = conversation.quality;
    if (!quality || !['complete', 'partial', 'unknown'].includes(quality.status)) throw new TypeError('Invalid Domain quality');
    const ids = quality.heuristicDocumentIds ?? [];
    if (new Set(ids).size !== ids.length || ids.some(id => !assets.has(id))) throw new TypeError('Invalid quality document reference');
    if ((quality.rejectedTurns || quality.truncation || ids.length) && quality.status !== 'partial') throw new TypeError('Content quality facts require partial status');
    conversation.messages.forEach((message, index) => {
        if (message.generation && (!['image', 'audio', 'video', 'other'].includes(message.generation.mediaKind) ||
            (message.generation.outputCount !== undefined && (!Number.isSafeInteger(message.generation.outputCount) || message.generation.outputCount < 0)))) {
            throw new TypeError(`Invalid Domain generation event in messages[${index}]`);
        }
        const citations = new Set<string>();
        for (const citation of message.citations ?? []) {
            if (typeof citation.id !== 'string' || !citation.id || citations.has(citation.id)) throw new TypeError(`Duplicate or empty Domain citation identity in messages[${index}]`);
            citations.add(citation.id);
        }
        const checkCitations = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) { value.forEach(checkCitations); return; }
            const node = value as Record<string, unknown>;
            if (node.type === 'citationRef' && (typeof node.citationId !== 'string' || !citations.has(node.citationId))) {
                throw new TypeError(`Unregistered Domain citation '${String(node.citationId)}' in messages[${index}]`);
            }
            Object.values(node).forEach(checkCitations);
        };
        checkCitations(message.content);
        checkCitations(message.reasoning);
        const reference = (ref: string): string => {
            if (!assets.has(ref)) throw new TypeError(`Unregistered Domain asset '${ref}' in messages[${index}]`);
            return ref;
        };
        const owned = message.attachmentIds ?? [];
        if (new Set(owned).size !== owned.length) throw new TypeError(`Duplicate Domain attachment reference in messages[${index}]`);
        owned.forEach(reference);
        mapContentAssetReferences(message.content, reference);
        if (message.reasoning !== undefined) {
            if (!Array.isArray(message.reasoning)) throw new TypeError('Domain reasoning must be Content AST');
            mapContentAssetReferences(message.reasoning, reference);
        }
    });
}
