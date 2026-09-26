/**
 * src/core/export/typst/payload.ts
 * Canonical bundle -> Typst v8 render payload adapter (P1a).
 *
 * The payload is a disposable transport for the proven v8 templates in
 * ./templates/; it is deliberately NOT the canonical archive model.
 *
 * Injection red line: user text travels ONLY as JSON data fields. This module
 * never interpolates user text into Typst source, and the templates consume
 * the payload via json() + eval() of adapter-controlled math only.
 *
 * Math: `convertMath` is the single controlled conversion hook
 * (source LaTeX -> trusted Typst math). Without a converter the raw `latex`
 * source is preserved and the template renders it as a visible note, never
 * silently dropped.
 *
 * P1b contract (not this PR): the sandbox compiler must pass
 * `beforeBuild: [loadFonts([], { assets: false })]` so typst.ts never pulls
 * fonts from jsdelivr, and must verify the MATH table at font-load time.
 * Scope here is payload only: no WASM loading, no sandbox page (P1b).
 */

import type { Asset } from '../canonical/assets.js';
import { collectReferencedAssetIds, collectBinaryRenderAssetIds } from '../canonical/assetReferences.js';
export { collectReferencedAssetIds, collectBinaryRenderAssetIds };
import type {
    BlockNode,
    ListBlock,
    TableCell,
    TableRow,
} from '../canonical/blocks.js';
import type {
    CanonicalConversationBundle,
    MessageNode,
} from '../canonical/conversation.js';
import type { InlineNode } from '../canonical/inline.js';

/** Disposable transport consumed by the proven Typst v8 templates. */
export type TypstInlineNode =
    | { type: 'text'; text: string }
    | { type: 'strong'; children: TypstInlineNode[] }
    | { type: 'emphasis'; children: TypstInlineNode[] }
    | { type: 'inlineCode'; text: string }
    | { type: 'link'; url: string; children: TypstInlineNode[] }
    | { type: 'lineBreak' }
    | { type: 'image'; asset: string; alt?: string }
    | { type: 'inlineMath'; latex: string; typst?: string };

export type TypstBlockNode =
    | { type: 'paragraph'; children: TypstInlineNode[] }
    | { type: 'heading'; level: 1 | 2 | 3; children: TypstInlineNode[] }
    | { type: 'list'; ordered: boolean; items: { children: TypstInlineNode[] }[] }
    | { type: 'code'; language: string; text: string }
    | { type: 'math'; latex: string; typst?: string }
    | {
        type: 'table';
        headers: TypstInlineNode[][];
        rows: TypstInlineNode[][][];
        columns?: number[];
        aligns?: ('left' | 'center' | 'right')[];
    }
    | { type: 'image'; asset: string; caption?: string }
    | { type: 'file'; name: string; kind: string; size: string }
    | { type: 'quote'; children: TypstInlineNode[] }
    | { type: 'note'; children: TypstInlineNode[] }
    | { type: 'unknown'; sourceType?: string; fallback?: string };

export type TypstRenderAttachment =
    | { type: 'file'; name: string; kind: string; size: string }
    | { type: 'image'; asset: string; name: string; meta: string; width?: number };

export interface TypstRenderMessage {
    id: string;
    role: 'user' | 'assistant';
    model?: string;
    plainText?: string;
    attachments?: TypstRenderAttachment[];
    blocks: TypstBlockNode[];
}

export interface TypstConversationRenderPayload {
    schemaVersion: 1;
    title: string;
    provider: string;
    date: string;
    messageCount: number;
    messages: TypstRenderMessage[];
}

export interface TypstAdapterDiagnostic {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    path?: string;
}

export interface TypstPayloadOptions {
    /**
     * Maps a canonical asset to the virtual path made available to Typst,
     * e.g. assets/sha256/ab/cd/image.png. Return undefined when the asset
     * has no path; the adapter emits a visible unknown node + diagnostic.
     */
    assetPath(asset: Asset): string | undefined;

    /**
     * Controlled math conversion: source math -> trusted Typst math.
     * Failure is represented by undefined (raw latex preserved).
     */
    convertMath?: (source: string, notation: string, display: boolean) => string | undefined;

    /**
     * D7 S3: pre-projected messages from the S1 projection stage.
     * When provided, the adapter skips its internal linearizeMessages and
     * uses these verbatim; the PDF pipeline must never re-derive the view.
     * When absent, behavior is unchanged (internal linearization).
     */
    projectedMessages?: MessageNode[];

    /** Explicit branch leaf overrides conversation.selectedLeafMessageId. */
    leafMessageId?: string;
}

export interface TypstPayloadResult {
    payload: TypstConversationRenderPayload;
    diagnostics: TypstAdapterDiagnostic[];
}

function humanBytes(value?: number): string {
    if (value == null || !Number.isFinite(value)) return 'size unknown';
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let n = value / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i += 1;
    }
    return `${n >= 10 ? n.toFixed(1) : n.toFixed(2)} ${units[i]}`;
}

function mimeLabel(asset: Asset): string {
    const mime = asset.mimeType?.toLowerCase();
    if (mime) {
        const subtype = mime.split('/')[1];
        if (subtype) return subtype.replace(/^x-/, '').toUpperCase();
    }
    const name = asset.name ?? '';
    const dot = name.lastIndexOf('.');
    if (dot >= 0 && dot < name.length - 1) return name.slice(dot + 1).toUpperCase();
    return asset.kind.toUpperCase();
}

function plainInline(nodes: InlineNode[], citations: Map<string, string>): string {
    return nodes.map(node => {
        switch (node.type) {
            case 'text': return node.text;
            case 'strong':
            case 'emphasis':
            case 'strikethrough': return plainInline(node.children, citations);
            case 'inlineCode': return node.code;
            case 'link': return plainInline(node.children, citations) || node.href;
            case 'inlineMath': return node.source;
            case 'citationRef': return node.label ?? citations.get(node.citationId) ?? `[${node.citationId}]`;
            case 'lineBreak': return '\n';
            case 'unknownInline': return node.fallbackText ?? `[${node.sourceType}]`;
        }
    }).join('');
}

function plainBlock(block: BlockNode, citations: Map<string, string>): string {
    switch (block.type) {
        case 'paragraph':
        case 'heading': return plainInline(block.children, citations);
        case 'list': return block.items.map(item => item.blocks.map(b => plainBlock(b, citations)).join(' ')).join('\n');
        case 'quote': return block.blocks.map(b => plainBlock(b, citations)).join('\n');
        case 'code': return block.code;
        case 'math': return block.source;
        case 'table': return [...(block.headerRows ?? []), ...block.rows]
            .map(row => row.cells.map(cell => plainInline(cell.children, citations)).join(' | ')).join('\n');
        case 'image': return block.alt ?? (block.caption ? plainInline(block.caption, citations) : '');
        case 'file': return block.label ?? (block.description ? plainInline(block.description, citations) : '');
        case 'citationGroup': return block.citationIds.map(id => citations.get(id) ?? id).join(', ');
        case 'thought': return block.blocks.map(b => plainBlock(b, citations)).join('\n');
        case 'toolCall': return block.displayBlocks?.map(b => plainBlock(b, citations)).join('\n') ?? `${block.toolName} tool call`;
        case 'toolResult': return block.displayBlocks?.map(b => plainBlock(b, citations)).join('\n') ?? `${block.toolName ?? block.callId} result`;
        case 'thematicBreak': return '---';
        case 'unknown': return block.fallbackBlocks?.map(b => plainBlock(b, citations)).join('\n') ?? `[${block.sourceType}]`;
    }
}

function renderInline(
    node: InlineNode,
    assets: Map<string, Asset>,
    citations: Map<string, { label: string; url?: string }>,
    options: TypstPayloadOptions,
    diagnostics: TypstAdapterDiagnostic[],
    path: string,
): TypstInlineNode {
    switch (node.type) {
        case 'text': return { type: 'text', text: node.text };
        case 'strong': return { type: 'strong', children: node.children.map(n => renderInline(n, assets, citations, options, diagnostics, path)) };
        case 'emphasis': return { type: 'emphasis', children: node.children.map(n => renderInline(n, assets, citations, options, diagnostics, path)) };
        case 'strikethrough':
            // v8 transport has no strike node; preserve text rather than styling.
            return { type: 'text', text: node.children.map(n => plainInline([n], new Map())).join('') };
        case 'inlineCode': return { type: 'inlineCode', text: node.code };
        case 'link': return { type: 'link', url: node.href, children: node.children.map(n => renderInline(n, assets, citations, options, diagnostics, path)) };
        case 'image': {
            // Inline images are first-class transport nodes now; only a missing
            // asset (not the transport) forces a visible fallback.
            const asset = assets.get(node.assetId);
            const assetPath = asset ? options.assetPath(asset) : undefined;
            if (!asset || !assetPath) {
                diagnostics.push({ severity: 'warning', code: 'TYPST_V8_INLINE_IMAGE_MISSING', message: `Inline image asset ${node.assetId} unavailable to Typst; showing alt text.`, path });
                return { type: 'text', text: node.alt ?? `[image: ${node.assetId}]` };
            }
            return { type: 'image', asset: assetPath, ...(node.alt ? { alt: node.alt } : {}) };
        }
        case 'inlineMath': {
            const typst = options.convertMath?.(node.source, node.notation, false);
            return typst
                ? { type: 'inlineMath', latex: node.source, typst }
                : { type: 'inlineMath', latex: node.source };
        }
        case 'citationRef': {
            const c = citations.get(node.citationId);
            const label = node.label ?? c?.label ?? `[${node.citationId}]`;
            return c?.url
                ? { type: 'link', url: c.url, children: [{ type: 'text', text: label }] }
                : { type: 'text', text: label };
        }
        case 'lineBreak': return { type: 'lineBreak' };
        case 'unknownInline': return { type: 'text', text: node.fallbackText ?? `[Unsupported inline: ${node.sourceType}]` };
    }
}

function flattenListItem(item: ListBlock['items'][number], citations: Map<string, string>): InlineNode[] {
    const text = item.blocks.map(b => plainBlock(b, citations)).join(' / ');
    return [{ type: 'text', text }];
}

function firstHeaderRow(rows?: TableRow[]): TableRow | undefined {
    return rows && rows.length > 0 ? rows[0] : undefined;
}

function cellInline(cell: TableCell): InlineNode[] {
    return cell.children;
}

function renderBlock(
    block: BlockNode,
    assets: Map<string, Asset>,
    citationLabels: Map<string, string>,
    citations: Map<string, { label: string; url?: string }>,
    options: TypstPayloadOptions,
    diagnostics: TypstAdapterDiagnostic[],
    path: string,
): TypstBlockNode | null {
    const inline = (nodes: InlineNode[]) => nodes.map(n => renderInline(n, assets, citations, options, diagnostics, path));
    switch (block.type) {
        case 'paragraph': return { type: 'paragraph', children: inline(block.children) };
        case 'heading': {
            const level = Math.min(block.level, 3) as 1 | 2 | 3;
            if (block.level > 3) diagnostics.push({ severity: 'warning', code: 'TYPST_V8_HEADING_CLAMP', message: `Heading level ${block.level} rendered as level 3.`, path });
            return { type: 'heading', level, children: inline(block.children) };
        }
        case 'list': {
            const plainCitations = new Map([...citations.entries()].map(([k, v]) => [k, v.label]));
            if (block.items.some(item => item.blocks.length !== 1 || item.blocks[0]?.type !== 'paragraph')) {
                diagnostics.push({ severity: 'warning', code: 'TYPST_V8_LIST_FLATTENED', message: 'Nested or multi-block list item flattened for the v8 transport.', path });
            }
            return {
                type: 'list',
                ordered: block.ordered,
                items: block.items.map(item => ({ children: inline(flattenListItem(item, plainCitations)) })),
            };
        }
        case 'quote': {
            const plainCitations = new Map([...citations.entries()].map(([k, v]) => [k, v.label]));
            return { type: 'quote', children: [{ type: 'text', text: block.blocks.map(b => plainBlock(b, plainCitations)).join('\n') }] };
        }
        case 'code': return { type: 'code', language: block.language ?? 'text', text: block.code };
        case 'math': {
            const typst = options.convertMath?.(block.source, block.notation, true);
            return typst ? { type: 'math', latex: block.source, typst } : { type: 'math', latex: block.source };
        }
        case 'table': {
            const header = firstHeaderRow(block.headerRows);
            const headers = header?.cells.map(c => inline(cellInline(c))) ?? [];
            if ((block.headerRows?.length ?? 0) > 1) diagnostics.push({ severity: 'warning', code: 'TYPST_V8_MULTI_HEADER_COLLAPSE', message: 'Only the first canonical header row is native in the v8 transport.', path });
            if ([...(block.headerRows ?? []), ...block.rows].some(r => r.cells.some(c => (c.colSpan ?? 1) !== 1 || (c.rowSpan ?? 1) !== 1))) {
                diagnostics.push({ severity: 'warning', code: 'TYPST_V8_TABLE_SPAN_IGNORED', message: 'colSpan/rowSpan are not supported by the v8 transport.', path });
            }
            const aligns = block.columns?.map(c => c.align === 'default' || !c.align ? 'left' : c.align);
            return {
                type: 'table',
                headers,
                rows: block.rows.map(row => row.cells.map(cell => inline(cell.children))),
                ...(aligns && aligns.length ? { aligns } : {}),
            };
        }
        case 'image': {
            const asset = assets.get(block.assetId);
            const assetPath = asset ? options.assetPath(asset) : undefined;
            if (!asset || !assetPath) {
                diagnostics.push({ severity: 'warning', code: 'TYPST_V8_IMAGE_MISSING', message: `Image asset ${block.assetId} unavailable to Typst.`, path });
                return { type: 'unknown', sourceType: 'missing-image', fallback: block.alt ?? `Missing image: ${block.assetId}` };
            }
            const plainCitations = new Map([...citations.entries()].map(([k, v]) => [k, v.label]));
            const caption = block.caption ? plainInline(block.caption, plainCitations) : block.alt;
            return { type: 'image', asset: assetPath, ...(caption ? { caption } : {}) };
        }
        case 'file': {
            const asset = assets.get(block.assetId);
            if (!asset) return { type: 'unknown', sourceType: 'missing-file', fallback: block.label ?? `Missing file: ${block.assetId}` };
            return { type: 'file', name: block.label ?? asset.name ?? block.assetId, kind: mimeLabel(asset), size: humanBytes(asset.sizeBytes) };
        }
        case 'citationGroup': {
            const text = block.citationIds.map(id => citations.get(id)?.label ?? id).join(' · ');
            return { type: 'note', children: [{ type: 'text', text: text || 'Sources' }] };
        }
        case 'thought': {
            const plainCitations = new Map([...citations.entries()].map(([k, v]) => [k, v.label]));
            return { type: 'note', children: [{ type: 'text', text: block.blocks.map(b => plainBlock(b, plainCitations)).join('\n') }] };
        }
        case 'toolCall':
        case 'toolResult': {
            const plainCitations = new Map([...citations.entries()].map(([k, v]) => [k, v.label]));
            return {
                type: 'unknown',
                sourceType: block.type,
                fallback: block.displayBlocks?.map(b => plainBlock(b, plainCitations)).join('\n') ?? (block.type === 'toolCall' ? `Tool call: ${block.toolName}` : `Tool result: ${block.toolName ?? block.callId}`),
            };
        }
        case 'thematicBreak': return { type: 'paragraph', children: [{ type: 'text', text: '—' }] };
        case 'unknown': {
            const plainCitations = new Map([...citations.entries()].map(([k, v]) => [k, v.label]));
            return { type: 'unknown', sourceType: block.sourceType, fallback: block.fallbackBlocks?.map(b => plainBlock(b, plainCitations)).join('\n') ?? 'Content preserved in archive but unavailable in this renderer.' };
        }
    }
}

function buildChildMap(messages: MessageNode[]): Map<string | null, MessageNode[]> {
    const map = new Map<string | null, MessageNode[]>();
    for (const message of messages) {
        const key = message.parentId ?? null;
        const arr = map.get(key) ?? [];
        arr.push(message);
        map.set(key, arr);
    }
    for (const arr of map.values()) {
        arr.sort((a, b) => (a.siblingIndex ?? 0) - (b.siblingIndex ?? 0) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
    }
    return map;
}

function linearizeMessages(bundle: CanonicalConversationBundle, leafOverride?: string): MessageNode[] {
    const messages = bundle.conversation.messages;
    if (messages.length === 0) return [];
    const byId = new Map(messages.map(m => [m.id, m]));
    const leaf = leafOverride ?? bundle.conversation.selectedLeafMessageId;
    if (leaf) {
        const chain: MessageNode[] = [];
        let current = byId.get(leaf);
        if (!current) throw new Error(`Selected leaf message not found: ${leaf}`);
        const seen = new Set<string>();
        while (current) {
            if (seen.has(current.id)) throw new Error(`Message parent cycle at ${current.id}`);
            seen.add(current.id);
            chain.push(current);
            current = current.parentId ? byId.get(current.parentId) : undefined;
        }
        return chain.reverse();
    }

    // Flat legacy conversations often have no parent ids at all.
    if (messages.every(m => !m.parentId)) {
        return [...messages].sort((a, b) => (a.siblingIndex ?? 0) - (b.siblingIndex ?? 0) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id));
    }

    const children = buildChildMap(messages);
    if ([...children.values()].some(group => group.length > 1)) {
        throw new Error('Conversation is branched but has no selectedLeafMessageId. Refusing to silently choose a branch.');
    }
    const roots = children.get(null) ?? [];
    if (roots.length !== 1) throw new Error(`Expected one root in unbranched message tree, found ${roots.length}.`);
    const result: MessageNode[] = [];
    let current: MessageNode | undefined = roots[0];
    while (current) {
        result.push(current);
        current = (children.get(current.id) ?? [])[0];
    }
    return result;
}

function rolePrefix(message: MessageNode): string | undefined {
    if (message.role === 'system') return 'System message';
    if (message.role === 'developer') return 'Developer message';
    if (message.role === 'tool') return 'Tool message';
    if (message.role === 'unknown') return message.author?.rawRole ? `Role: ${message.author.rawRole}` : 'Unknown role';
    return undefined;
}

function toRenderMessage(
    message: MessageNode,
    assets: Map<string, Asset>,
    citationLabels: Map<string, string>,
    citations: Map<string, { label: string; url?: string }>,
    options: TypstPayloadOptions,
    diagnostics: TypstAdapterDiagnostic[],
): TypstRenderMessage {
    const blocks: TypstBlockNode[] = [];
    const prefix = rolePrefix(message);
    if (prefix) blocks.push({ type: 'note', children: [{ type: 'text', text: prefix }] });
    message.blocks.forEach((block, index) => {
        const mapped = renderBlock(block, assets, citationLabels, citations, options, diagnostics, `message:${message.id}/block:${index}`);
        if (mapped) blocks.push(mapped);
    });

    // Message-level asset association is NOT used to invent ordering. It only
    // supplies attachments for associated assets that have no placement in the
    // message: an inline image is inline placement, so its asset must not also
    // appear as a trailing attachment.
    const referencedIds = collectReferencedAssetIds(message.blocks);
    const attachments: TypstRenderAttachment[] = [];
    for (const id of message.associatedAssetIds ?? []) {
        if (referencedIds.has(id)) continue;
        const asset = assets.get(id);
        if (!asset) continue;
        if (asset.kind === 'image') {
            const path = options.assetPath(asset);
            if (path) attachments.push({ type: 'image', asset: path, name: asset.name ?? id, meta: `${mimeLabel(asset)} · ${humanBytes(asset.sizeBytes)}` });
        } else {
            attachments.push({ type: 'file', name: asset.name ?? id, kind: mimeLabel(asset), size: humanBytes(asset.sizeBytes) });
        }
    }

    const plainCitations = new Map([...citations.entries()].map(([k, v]) => [k, v.label]));
    const plainText = message.blocks.map(b => plainBlock(b, plainCitations)).join('\n');
    return {
        id: message.id,
        role: message.role === 'user' ? 'user' : 'assistant',
        ...(message.author?.model ? { model: message.author.model } : {}),
        ...(plainText ? { plainText } : {}),
        ...(attachments.length ? { attachments } : {}),
        blocks,
    };
}

/**
 * Convert a canonical conversation bundle to the Typst v8 render payload.
 * Text travels as JSON data only; this function builds no Typst source.
 */
export function toTypstPayload(
    bundle: CanonicalConversationBundle,
    options: TypstPayloadOptions,
): TypstPayloadResult {
    const diagnostics: TypstAdapterDiagnostic[] = [];
    const assets = new Map(bundle.assets.map(asset => [asset.id, asset]));
    const citations = new Map(bundle.citations.map((citation, index) => [citation.id, {
        label: `[${index + 1}]`,
        url: citation.url,
    }]));
    const citationLabels = new Map([...citations.entries()].map(([id, c]) => [id, c.label]));

    // D7 S3 may hand us the S1 projected view directly; only fall back to
    // internal linearization for callers that do not project first.
    const messages = (options.projectedMessages ?? linearizeMessages(bundle, options.leafMessageId))
        .map(message => toRenderMessage(message, assets, citationLabels, citations, options, diagnostics));

    const observed = bundle.conversation.updatedAt ?? bundle.conversation.createdAt ?? bundle.conversation.observedAt ?? '';
    const date = observed ? observed.slice(0, 10) : 'date unknown';

    return {
        payload: {
            schemaVersion: 1,
            title: bundle.conversation.title?.value ?? 'Untitled conversation',
            provider: bundle.conversation.key.providerId,
            date,
            messageCount: messages.length,
            messages,
        },
        diagnostics,
    };
}
