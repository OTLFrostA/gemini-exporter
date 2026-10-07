import type { DisplayBlock, DisplayInline, DocumentAst } from '../document/ast.js';

/** Match renderDocumentTypst's image capability, not every rich reference in the AST.
 * Captions, file descriptions, placeholder details and source headings degrade to text.
 * Their inline images remain in the shared AST but need no PDF acquisition or mount.
 */
export function collectPdfImageIds(document: DocumentAst): Set<string> {
    const ids = new Set<string>();
    const inlines = (nodes: DisplayInline[]): void => {
        for (const node of nodes) {
            if (node.type === 'image') ids.add(node.resourceId);
            if ('children' in node) inlines(node.children);
        }
    };
    const blocks = (nodes: DisplayBlock[]): void => {
        for (const node of nodes) {
            switch (node.type) {
                case 'image': ids.add(node.resourceId); break;
                case 'paragraph': case 'heading': inlines(node.children); break;
                case 'quote': case 'disclosure': blocks(node.blocks); break;
                case 'list': for (const item of node.items) blocks(item.blocks); break;
                case 'table':
                    for (const row of [...node.headerRows, ...node.rows]) {
                        for (const cell of row) inlines(cell.children);
                    }
                    break;
                case 'file': case 'placeholder': case 'code': case 'math': case 'unsupported': case 'thematicBreak': break;
                default: {
                    const exhaustive: never = node;
                    throw new TypeError(`Unknown PDF block: ${String(exhaustive)}`);
                }
            }
        }
    };
    for (const message of document.messages) blocks(message.blocks);
    return ids;
}
