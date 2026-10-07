import type { DisplayBlock, DisplayInline, DocumentAst } from './ast.js';

/** Walk the logical tree, including rich captions and nested metadata. Placement determines binary needs. */
export function collectDocumentResources(document: DocumentAst): { referencedIds: Set<string>; imageIds: Set<string> } {
    const referencedIds = new Set<string>(), imageIds = new Set<string>();
    const reference = (id: string, image: boolean): void => {
        referencedIds.add(id);
        if (image) imageIds.add(id);
    };
    const inlines = (nodes: DisplayInline[] = []): void => {
        for (const node of nodes) {
            if (node.type === 'image') reference(node.resourceId, true);
            if (node.type === 'placeholder' && node.resourceId) reference(node.resourceId, node.kind === 'image');
            if ('children' in node) inlines(node.children);
        }
    };
    const blocks = (nodes: DisplayBlock[]): void => {
        for (const node of nodes) {
            if ('resourceId' in node && node.resourceId) reference(node.resourceId, node.type === 'image' || (node.type === 'placeholder' && node.kind === 'image'));
            if ('children' in node) inlines(node.children);
            if ('caption' in node) inlines(node.caption);
            if ('description' in node) inlines(node.description);
            if ('details' in node) inlines(node.details);
            if ('blocks' in node && node.blocks) blocks(node.blocks);
            if (node.type === 'list') for (const item of node.items) blocks(item.blocks);
            if (node.type === 'table') for (const row of [...node.headerRows, ...node.rows]) for (const cell of row) inlines(cell.children);
        }
    };
    for (const message of document.messages) {
        inlines(message.sources?.heading);
        blocks(message.blocks);
    }
    return { referencedIds, imageIds };
}
