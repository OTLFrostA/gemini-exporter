import type { BlockNode } from './blocks.js';
import type { InlineNode } from './inline.js';
import type { CanonicalConversationBundle, MessageNode } from './conversation.js';

function collectImpl(blocks: BlockNode[] | undefined, imagesOnly: boolean): Set<string> {
    const ids = new Set<string>();
    const walkInline = (nodes: InlineNode[]): void => {
        for (const node of nodes) {
            switch (node.type) {
                case 'image': ids.add(node.assetId); break;
                case 'strong':
                case 'emphasis':
                case 'strikethrough':
                case 'link': walkInline(node.children); break;
                default: break;
            }
        }
    };
    const walkBlocks = (list: BlockNode[]): void => {
        for (const block of list) {
            switch (block.type) {
                case 'image': ids.add(block.assetId); break;
                case 'file': if (!imagesOnly) ids.add(block.assetId); break;
                default: break;
            }
            switch (block.type) {
                case 'paragraph':
                case 'heading': walkInline(block.children); break;
                case 'list':
                    for (const item of block.items) walkBlocks(item.blocks);
                    break;
                case 'quote':
                case 'thought': walkBlocks(block.blocks); break;
                case 'table': {
                    for (const row of [...(block.headerRows ?? []), ...block.rows]) {
                        for (const cell of row.cells) walkInline(cell.children);
                    }
                    if (block.caption) walkInline(block.caption);
                    break;
                }
                case 'image': if (block.caption) walkInline(block.caption); break;
                case 'file': if (block.description) walkInline(block.description); break;
                case 'citationGroup': if (block.title) walkInline(block.title); break;
                case 'toolCall':
                case 'toolResult':
                    if (block.displayBlocks) walkBlocks(block.displayBlocks);
                    break;
                case 'unknown':
                    if (block.fallbackBlocks) walkBlocks(block.fallbackBlocks);
                    break;
                default: break;
            }
        }
    };
    walkBlocks(blocks ?? []);
    return ids;
}

export function collectReferencedAssetIds(blocks: BlockNode[] | undefined): Set<string> {
    return collectImpl(blocks, false);
}

/**
 * Binary byte resolution follows AST placement (ImageBlock / ImageInline) rather than
 * Asset.kind, since a 'file'-kind asset placed as an image still needs bytes while a FileBlock only renders metadata.
 */
export function collectBinaryRenderAssetIds(blocks: BlockNode[] | undefined): Set<string> {
    return collectImpl(blocks, true);
}

/**
 * Unplaced message-level attachments have no AST block placement, so their Asset.kind
 * determines whether they render as trailing images (requiring bytes) or metadata-only file cards.
 */
export interface CompanionPlacementPlan {
    trailingImages: string[];
    trailingFiles: string[];
    ignored: Array<{ assetId: string; reason: string }>;
    diagnostics: Array<{ severity: 'warning'; code: string; message: string; path?: string }>;
}

function collectToolResultAssetIds(blocks: BlockNode[] | undefined): string[] {
    const out: string[] = [];
    const walk = (list: BlockNode[]): void => {
        for (const block of list) {
            if (block.type === 'toolResult') {
                for (const id of block.assetIds ?? []) out.push(id);
            }
            switch (block.type) {
                case 'list':
                    for (const item of block.items) walk(item.blocks);
                    break;
                case 'quote':
                case 'thought':
                    walk(block.blocks);
                    break;
                case 'toolCall':
                case 'toolResult':
                    if (block.displayBlocks) walk(block.displayBlocks);
                    break;
                case 'unknown':
                    if (block.fallbackBlocks) walk(block.fallbackBlocks);
                    break;
                default: break;
            }
        }
    };
    walk(blocks ?? []);
    return out;
}

export function collectCompanionPlacements(
    message: MessageNode | undefined,
    bundle: CanonicalConversationBundle,
): CompanionPlacementPlan {
    const trailingImages: string[] = [];
    const trailingFiles: string[] = [];
    const ignored: Array<{ assetId: string; reason: string }> = [];
    const diagnostics: CompanionPlacementPlan['diagnostics'] = [];
    const seen = new Set<string>(collectReferencedAssetIds(message?.blocks));
    const byId = new Map((bundle.assets ?? []).map((a) => [a.id, a]));
    const consider = (id: string, source: string): void => {
        if (seen.has(id)) return;
        seen.add(id);
        const asset = byId.get(id);
        if (!asset) {
            const reason = `${source} references unknown asset ${id}; skipping companion placement`;
            ignored.push({ assetId: id, reason });
            diagnostics.push({
                severity: 'warning',
                code: 'ASSET_UNRESOLVED',
                message: reason,
                path: message?.id ? `message:${message.id}` : undefined,
            });
            return;
        }
        if (asset.kind === 'image') trailingImages.push(id);
        else trailingFiles.push(id);
    };
    for (const id of message?.associatedAssetIds ?? []) consider(id, 'associatedAssetIds');
    for (const id of collectToolResultAssetIds(message?.blocks)) consider(id, 'toolResult.assetIds');
    return { trailingImages, trailingFiles, ignored, diagnostics };
}
