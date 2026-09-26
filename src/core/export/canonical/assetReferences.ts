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
import type { MessageNode } from './conversation.js';

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

/**
 * Collect message-level associated asset ids that render as trailing image
 * attachments: ids in message.associatedAssetIds with no block placement
 * (absent from referencedIds) whose asset kind is 'image'.
 *
 * The kind check is legitimate here because the Typst payload builder's own
 * `asset.kind === 'image'` branch is what defines that usage as an image:
 * kind-'image' companions without block placement become trailing image
 * attachments (Typst image()); other/unknown kinds render metadata-only
 * file cards and never need bytes. Unknown ids (kindOf() === undefined)
 * are excluded, matching the payload's skip of unknown ids.
 *
 * Shared by resourceStage (binary resolution) and the Typst payload builder
 * (trailing attachment emission) so the two can never disagree about which
 * companions need image bytes. Placement still decides for block-tree
 * images (see collectBinaryRenderAssetIds); this helper covers only the
 * message-level association index (roadmap §43: messages link resources via
 * blocks AND associatedAssetIds).
 */
export function collectUnplacedAssociatedImageIds(
    message: MessageNode | undefined,
    referencedIds: ReadonlySet<string>,
    kindOf: (id: string) => string | undefined,
): Set<string> {
    const out = new Set<string>();
    for (const id of message?.associatedAssetIds ?? []) {
        if (referencedIds.has(id)) continue;
        if (kindOf(id) !== 'image') continue;
        out.add(id);
    }
    return out;
}
