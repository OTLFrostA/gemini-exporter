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

function visitTypstNodes(
    doc: TypstConversationRenderPayload,
    handlers: {
        onInline?: (node: TypstInlineNode) => void;
        onBlock?: (block: TypstBlockNode) => void;
    },
): void {
    const visitInline = (nodes: readonly TypstInlineNode[]): void => {
        for (const node of nodes) {
            handlers.onInline?.(node);
            switch (node.type) {
                case 'strong':
                case 'emphasis':
                case 'strikethrough':
                case 'link':
                    visitInline(node.children);
                    break;
                case 'text':
                case 'inlineCode':
                case 'inlineMath':
                case 'image':
                case 'lineBreak':
                    break;
                default: {
                    const exhaustive: never = node;
                    return exhaustive;
                }
            }
        }
    };
    const visitBlock = (block: TypstBlockNode): void => {
        handlers.onBlock?.(block);
        switch (block.type) {
            case 'paragraph':
            case 'heading':
                visitInline(block.children);
                break;
            case 'quote':
                for (const child of block.blocks) visitBlock(child);
                break;
            case 'note':
                if (block.children) visitInline(block.children);
                if (block.blocks) for (const child of block.blocks) visitBlock(child);
                break;
            case 'list':
                for (const item of block.items) for (const child of item.blocks) visitBlock(child);
                break;
            case 'table':
                if (block.caption) visitInline(block.caption);
                for (const row of block.headers) for (const cell of row) visitInline(cell.children);
                for (const row of block.rows) for (const cell of row) visitInline(cell.children);
                break;
            case 'image':
                if (block.caption) visitInline(block.caption);
                break;
            case 'file':
                if (block.description) visitInline(block.description);
                break;
            case 'unknown':
                if (block.details) visitInline(block.details);
                break;
            case 'code':
            case 'math':
            case 'thematicBreak':
                break;
            default: {
                const exhaustive: never = block;
                return exhaustive;
            }
        }
    };
    for (const message of doc.messages) {
        for (const block of message.blocks) visitBlock(block);
    }
}

// Typst hard-fails math layout if no loaded font has an OpenType MATH table;
// stripping `typst` fields degrades math nodes to their raw LaTeX fallback.
export function stripConvertedMath(doc: TypstConversationRenderPayload): number {
    let stripped = 0;
    visitTypstNodes(doc, {
        onInline: node => {
            if (node.type === 'inlineMath' && node.typst !== undefined) {
                delete node.typst;
                stripped += 1;
            }
        },
        onBlock: block => {
            if (block.type === 'math' && block.typst !== undefined) {
                delete block.typst;
                stripped += 1;
            }
        },
    });
    return stripped;
}

export function collectImagePaths(doc: TypstConversationRenderPayload): Set<string> {
    const paths = new Set<string>();
    visitTypstNodes(doc, {
        onInline: node => {
            if (node.type === 'image') paths.add(node.asset);
        },
        onBlock: block => {
            if (block.type === 'image') paths.add(block.asset);
        },
    });
    return paths;
}
