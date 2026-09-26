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

import type { BlockNode } from './blocks.js';
import type { InlineNode } from './inline.js';

/**
 * Shared walker for both collectors below. When imagesOnly is true, only
 * image placements (ImageBlock / ImageInline) are collected; otherwise every
 * referenced asset id is collected. The traversal shape is identical in
 * both modes so the two sets can never disagree about *where* assets are
 * referenced — only about which placements count.
 *
 * Nested positions covered: paragraph/heading children, table cells +
 * table caption, image captions, file descriptions, citationGroup titles,
 * list items, quote/thought blocks, toolCall/toolResult displayBlocks,
 * unknown fallbackBlocks.
 */
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
                // Image placements always count. File blocks only count in
                // full-reference mode: in images-only mode they are
                // metadata-only (their file card renders from the Asset
                // entity), even if the asset's kind claims 'image'.
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

/**
 * Recursively collect every asset id a message's blocks reference, walking
 * both the block tree and every inline tree. Returns a set of asset ids;
 * resolution (bytes/URLs/omissions) is the caller's job.
 */
export function collectReferencedAssetIds(blocks: BlockNode[] | undefined): Set<string> {
    return collectImpl(blocks, false);
}

/**
 * Collect the subset of referenced asset ids a renderer needs as binary
 * bytes (Typst image(), sandbox mounts), decided by AST placement — every
 * ImageBlock.assetId and ImageInline.assetId, including nested positions —
 * not by Asset.kind metadata.
 *
 * Placement is what makes Typst call image(path): the canonical validator
 * does not force ImageBlock -> Asset.kind === 'image', so a block can
 * reference a kind:'file' asset whose bytes are genuinely a PNG. Judging
 * by kind would skip its bytes and silently degrade the image; judging by
 * placement keeps it. Conversely a FileBlock referencing a kind:'image'
 * asset is metadata-only (its file card renders from the Asset entity) and
 * never needs bytes.
 *
 * A kind/placement mismatch (image placement -> known kind !== 'image')
 * still resolves by placement, but resourceStage emits an
 * ASSET_KIND_MISMATCH warning diagnostic for it.
 */
export function collectBinaryRenderAssetIds(blocks: BlockNode[] | undefined): Set<string> {
    return collectImpl(blocks, true);
}
