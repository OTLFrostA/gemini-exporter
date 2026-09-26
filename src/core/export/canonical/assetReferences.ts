/**
 * src/core/export/canonical/assetReferences.ts
 * Shared asset-reference collector for the canonical Block AST.
 *
 * Single implementation of "every asset id a message's blocks reference",
 * consumed by every renderer (HTML, Typst, future). Walks both the block
 * tree and every inline tree (paragraph/heading children, table cells, list
 * items, quote/thought/display blocks, link/strong/emphasis children, ...).
 *
 * An inline image is inline placement, so its asset id counts as "already
 * placed" exactly like a top-level image/file block: renderers must not
 * invent a second (attachment/carousel/companion) placement for it, and
 * companion-resource plans must know about it.
 */

import type { AssetKind } from './assets.js';
import type { BlockNode } from './blocks.js';
import type { InlineNode } from './inline.js';

/**
 * Recursively collect every asset id a message's blocks reference, walking
 * both the block tree and every inline tree. Returns a set of asset ids;
 * resolution (bytes/URLs/omissions) is the caller's job.
 */
export function collectReferencedAssetIds(blocks: BlockNode[] | undefined): Set<string> {    const ids = new Set<string>();
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
                case 'image':
                case 'file': ids.add(block.assetId); break;
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

/**
 * Collect the subset of referenced asset ids a renderer needs as binary
 * bytes (Typst image(), sandbox mounts): image-kind assets.
 *
 * File/audio/video attachments render as metadata-only cards straight from
 * the Asset entity (name/mimeType/sizeBytes) and must skip byte resolution
 * entirely — no read, no hash, no byteStore traffic, no mount. A 40MB
 * report.pdf that only shows "report.pdf · PDF · 40 MB" therefore costs
 * nothing in the resource pipeline.
 *
 * kindOf resolves the asset's canonical kind. Ids with unknown kind are
 * kept (fail-safe): an unclassifiable reference still goes through the
 * resolver so it is diagnosed instead of going silent.
 */
export function collectBinaryRenderAssetIds(
    blocks: BlockNode[] | undefined,
    kindOf: (assetId: string) => AssetKind | undefined,
): Set<string> {
    const out = new Set<string>();
    for (const id of collectReferencedAssetIds(blocks)) {
        const kind = kindOf(id);
        if (kind === undefined || kind === 'image') out.add(id);
    }
    return out;
}
