import type { DomainConversationDetail } from './conversationDetail.js';
import { mapContentAssetReferences } from './content/assetReferences.js';
import type { BlockNode } from './content/blocks.js';
import type { InlineNode } from './content/inline.js';

/** Domain is a closed, JSON-portable semantic graph; invalid references never reach exporters. */
export function assertDomainClosure(conversation: Pick<DomainConversationDetail, 'assets' | 'messages'>): void {
    const assets = new Set<string>();
    for (const asset of conversation.assets) {
        if (!asset.id || assets.has(asset.id)) throw new TypeError(`Duplicate or empty Domain asset identity: ${asset.id}`);
        assets.add(asset.id);
    }
    conversation.messages.forEach((message, index) => {
        const citations = new Set<string>();
        for (const citation of message.citations ?? []) {
            if (!citation.id || citations.has(citation.id)) throw new TypeError(`Duplicate or empty Domain citation identity in messages[${index}]`);
            citations.add(citation.id);
        }
        // Schema validation has already established the Content AST shape.
        // Traverse its typed edges instead of rediscovering arbitrary object structure.
        const checkInline = (node: InlineNode): void => {
            switch (node.type) {
                case 'citationRef':
                    if (!citations.has(node.citationId)) {
                        throw new TypeError(`Unregistered Domain citation '${String(node.citationId)}' in messages[${index}]`);
                    }
                    return;
                case 'strong':
                case 'emphasis':
                case 'strikethrough':
                case 'link':
                    node.children.forEach(checkInline);
                    return;
                case 'text':
                case 'inlineCode':
                case 'image':
                case 'inlineMath':
                case 'lineBreak':
                    return;
                default: {
                    const exhaustive: never = node;
                    return exhaustive;
                }
            }
        };
        const checkBlock = (node: BlockNode): void => {
            switch (node.type) {
                case 'paragraph':
                case 'heading':
                    node.children.forEach(checkInline);
                    return;
                case 'list':
                    node.items.forEach(item => item.blocks.forEach(checkBlock));
                    return;
                case 'quote':
                    node.blocks.forEach(checkBlock);
                    return;
                case 'table':
                    node.caption?.forEach(checkInline);
                    node.headerRows?.forEach(row => row.cells.forEach(cell => cell.children.forEach(checkInline)));
                    node.rows.forEach(row => row.cells.forEach(cell => cell.children.forEach(checkInline)));
                    return;
                case 'image':
                    node.caption?.forEach(checkInline);
                    return;
                case 'file':
                    node.description?.forEach(checkInline);
                    return;
                case 'code':
                case 'math':
                case 'thematicBreak':
                case 'unknown':
                    return;
                default: {
                    const exhaustive: never = node;
                    return exhaustive;
                }
            }
        };
        message.content.forEach(checkBlock);
        message.reasoning?.forEach(checkBlock);
        const reference = (ref: string): string => {
            if (!assets.has(ref)) throw new TypeError(`Unregistered Domain asset '${ref}' in messages[${index}]`);
            return ref;
        };
        const owned = message.attachmentIds ?? [];
        if (new Set(owned).size !== owned.length) throw new TypeError(`Duplicate Domain attachment reference in messages[${index}]`);
        owned.forEach(reference);
        mapContentAssetReferences(message.content, reference);
        if (message.reasoning !== undefined) mapContentAssetReferences(message.reasoning, reference);
    });
}
