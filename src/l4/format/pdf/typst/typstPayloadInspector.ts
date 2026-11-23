import type {
    TypstBlockNode,
    TypstConversationRenderPayload,
    TypstInlineNode,
} from '../../typst/transport.js';

export function fontHasMathTable(bytes: Uint8Array): boolean {
    if (bytes.length < 12) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const numTables = view.getUint16(4);
    if (bytes.length < 12 + numTables * 16) return false;
    for (let i = 0; i < numTables; i += 1) {
        if (view.getUint32(12 + i * 16) === 0x4d415448) return true;
    }
    return false;
}

// Typst hard-fails math layout if no loaded font has an OpenType MATH table;
// stripping `typst` fields degrades math nodes to their raw LaTeX fallback.
export function stripConvertedMath(doc: TypstConversationRenderPayload): number {
    let stripped = 0;
    const stripInline = (nodes: TypstInlineNode[]): void => {
        for (const node of nodes) {
            if ((node.type === 'strong' || node.type === 'emphasis' || node.type === 'strikethrough' || node.type === 'link') && 'children' in node) {
                stripInline(node.children);
            } else if (node.type === 'inlineMath' && 'typst' in node && node.typst !== undefined) {
                delete node.typst;
                stripped += 1;
            }
        }
    };
    const stripBlock = (block: TypstBlockNode): void => {
        if ('caption' in block && block.caption) stripInline(block.caption);
        if ('description' in block && block.description) stripInline(block.description);
        if ('details' in block && block.details) stripInline(block.details);
        switch (block.type) {
            case 'paragraph':
            case 'heading':
                stripInline(block.children);
                break;
            case 'quote':
                for (const child of block.blocks) stripBlock(child);
                break;
            case 'note':
                if (block.children) stripInline(block.children);
                if (block.blocks) for (const child of block.blocks) stripBlock(child);
                break;
            case 'list':
                for (const item of block.items) for (const child of item.blocks) stripBlock(child);
                break;
            case 'table':
                for (const row of block.headers) {
                    for (const cell of row) stripInline(cell.children);
                }
                for (const row of block.rows) {
                    for (const cell of row) stripInline(cell.children);
                }
                break;
            case 'math':
                if ('typst' in block && block.typst !== undefined) {
                    delete block.typst;
                    stripped += 1;
                }
                break;
            default:
                break;
        }
    };
    for (const message of doc.messages) {
        for (const block of message.blocks) stripBlock(block);
    }
    return stripped;
}

export function collectImagePaths(doc: TypstConversationRenderPayload): Set<string> {
    const paths = new Set<string>();
    const visitInline = (nodes: TypstInlineNode[]): void => {
        for (const node of nodes) {
            if (node.type === 'image') {
                paths.add(node.asset);
            } else if ((node.type === 'strong' || node.type === 'emphasis' || node.type === 'strikethrough' || node.type === 'link') && 'children' in node) {
                visitInline(node.children);
            }
        }
    };
    const visitBlock = (block: TypstBlockNode): void => {
        if ('caption' in block && block.caption) visitInline(block.caption);
        if ('description' in block && block.description) visitInline(block.description);
        if ('details' in block && block.details) visitInline(block.details);
        if (block.type === 'image') {
            paths.add(block.asset);
        } else if (block.type === 'paragraph' || block.type === 'heading') {
            visitInline(block.children);
        } else if (block.type === 'quote') {
            for (const child of block.blocks) visitBlock(child);
        } else if (block.type === 'note') {
            if (block.children) visitInline(block.children);
            if (block.blocks) for (const child of block.blocks) visitBlock(child);
        } else if (block.type === 'list') {
            for (const item of block.items) for (const child of item.blocks) visitBlock(child);
        } else if (block.type === 'table') {
            for (const row of block.headers) for (const cell of row) visitInline(cell.children);
            for (const row of block.rows) {
                for (const cell of row) visitInline(cell.children);
            }
        }
    };
    for (const message of doc.messages) {
        for (const block of message.blocks) visitBlock(block);
    }
    return paths;
}
