import type { BlockNode } from '../../../l2/content/blocks.js';
import type { InlineNode } from '../../../l2/content/inline.js';
import type { DomainAsset } from '../../../l2/conversationDetail.js';
import type { ChatGPTApiConversationWithId } from './chatgptTypes.js';
import { parseChatGPTConversation } from './parseConversation.js';
import { assetIdForPointer } from './conversationTree.js';

/** Export archives also use Markdown-local images and sandbox download links. Register
 * those references as resources without rewriting fenced code or ordinary web links. */
export function parseOpenAIConversation(conversation: ChatGPTApiConversationWithId) {
    const parsed = parseChatGPTConversation({ conversation, assetsByNode: new Map() });
    const assets = parsed.conversation.detail.assets;
    function register(uri: string, kind: DomainAsset['kind']): string {
        const existing = assets.find(asset => asset.id === uri || asset.sourceUri === uri);
        if (existing) return existing.id;
        const base = `${kind}-${assetIdForPointer(uri)}`;
        let id = base;
        for (let suffix = 1; assets.some(asset => asset.id === id); suffix++) id = `${base}-${suffix}`;
        assets.push({ id, kind, sourceUri: uri });
        return id;
    }
    for (const message of parsed.conversation.detail.messages) {
        const files = new Set<string>();
        const inlines = (nodes: InlineNode[]): InlineNode[] => nodes.flatMap((node): InlineNode[] => {
            if (node.type === 'image') return [{ ...node, assetId: register(node.assetId, 'image') }];
            if (node.type === 'link' && /^sandbox:\/mnt\/data\//.test(node.href)) {
                files.add(register(node.href, 'file'));
                return inlines(node.children);
            }
            return ['children' in node ? { ...node, children: inlines(node.children) } : node];
        });
        const blocks = (nodes: BlockNode[]): BlockNode[] => nodes.map(node => {
            switch (node.type) {
                case 'paragraph': case 'heading': return { ...node, children: inlines(node.children) };
                case 'image': return { ...node, assetId: register(node.assetId, 'image'), ...(node.caption ? { caption: inlines(node.caption) } : {}) };
                case 'quote': return { ...node, blocks: blocks(node.blocks) };
                case 'list': return { ...node, items: node.items.map(item => ({ ...item, blocks: blocks(item.blocks) })) };
                case 'table': {
                    const rows = (rows: typeof node.rows) => rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell, children: inlines(cell.children) })) }));
                    return { ...node, rows: rows(node.rows), ...(node.headerRows ? { headerRows: rows(node.headerRows) } : {}),
                        ...(node.caption ? { caption: inlines(node.caption) } : {}) };
                }
                default: return node;
            }
        });
        message.content = blocks(message.content);
        if (message.reasoning) message.reasoning = blocks(message.reasoning);
        message.content.push(...[...files].map(assetId => ({ type: 'file' as const, assetId })));
    }
    return parsed;
}
