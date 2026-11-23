import type { DisplayBlock, DisplayInline, DocumentAst } from './ast.js';

/** Walk the logical tree, including rich captions and nested metadata. Placement determines binary needs. */
export function collectDocumentResources(document: DocumentAst): {
    referencedIds: Set<string>;
    imageIds: Set<string>;
    fileIds: Set<string>;
} {
    const referencedIds = new Set<string>(), imageIds = new Set<string>(), fileIds = new Set<string>();
    const reference = (id: string, image: boolean): void => {
        referencedIds.add(id);
        if (image) imageIds.add(id);
        else fileIds.add(id);
    };
    const inlines = (nodes: readonly DisplayInline[] = []): void => {
        for (const node of nodes) {
            switch (node.type) {
                case 'image':
                    reference(node.resourceId, true);
                    break;
                case 'strong':
                case 'emphasis':
                case 'strikethrough':
                case 'link':
                    inlines(node.children);
                    break;
                case 'text':
                case 'inlineCode':
                case 'inlineMath':
                case 'citation':
                case 'lineBreak':
                    break;
                default: {
                    const exhaustive: never = node;
                    return exhaustive;
                }
            }
        }
    };
    const blocks = (nodes: readonly DisplayBlock[]): void => {
        for (const node of nodes) {
            switch (node.type) {
                case 'image':
                    reference(node.resourceId, true);
                    if (node.caption) inlines(node.caption);
                    break;
                case 'file':
                    reference(node.resourceId, false);
                    if (node.description) inlines(node.description);
                    break;
                case 'paragraph':
                case 'heading':
                    inlines(node.children);
                    break;
                case 'quote':
                case 'disclosure':
                    blocks(node.blocks);
                    break;
                case 'list':
                    for (const item of node.items) blocks(item.blocks);
                    break;
                case 'table':
                    if (node.caption) inlines(node.caption);
                    for (const row of node.headerRows) for (const cell of row) inlines(cell.children);
                    for (const row of node.rows) for (const cell of row) inlines(cell.children);
                    break;
                case 'code':
                case 'math':
                case 'thematicBreak':
                case 'unsupported':
                    break;
                default: {
                    const exhaustive: never = node;
                    return exhaustive;
                }
            }
        }
    };
    for (const message of document.messages) {
        blocks(message.blocks);
    }
    return { referencedIds, imageIds, fileIds };
}
