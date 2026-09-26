// User text travels strictly as JSON data fields consumed via json() in Typst; only convertMath output is evaluated as Typst math.

import type { Asset } from '../canonical/assets.js';
import { collectReferencedAssetIds, collectBinaryRenderAssetIds, collectUnplacedAssociatedImageIds } from '../canonical/assetReferences.js';
import type {
    BlockNode,
    TableCell,
    TableRow,
} from '../canonical/blocks.js';
import type {
    CanonicalConversationBundle,
    MessageNode,
} from '../canonical/conversation.js';
import { projectConversation } from '../canonical/projection.js';
import type { InlineNode } from '../canonical/inline.js';

export type TypstInlineNode =
    | { type: 'text'; text: string }
    | { type: 'strong'; children: TypstInlineNode[] }
    | { type: 'emphasis'; children: TypstInlineNode[] }
    | { type: 'inlineCode'; text: string }
    | { type: 'link'; url: string; children: TypstInlineNode[] }
    | { type: 'lineBreak' }
    | { type: 'image'; asset: string; alt?: string }
    | { type: 'inlineMath'; latex: string; typst?: string };

export type TypstListItem = { blocks: TypstBlockNode[] };

export type TypstBlockNode =
    | { type: 'paragraph'; children: TypstInlineNode[] }
    | { type: 'heading'; level: 1 | 2 | 3; children: TypstInlineNode[] }
    | { type: 'list'; ordered: boolean; start?: number; items: TypstListItem[] }
    | { type: 'code'; language: string; text: string }
    | { type: 'math'; latex: string; typst?: string }
    | {
        type: 'table';
        headers: TypstInlineNode[][];
        rows: TypstInlineNode[][][];
        columns?: number[];
        aligns?: ('left' | 'center' | 'right')[];
        caption?: string;
    }
    | { type: 'image'; asset: string; caption?: string }
    | { type: 'file'; name: string; kind: string; size: string }
    | { type: 'quote'; blocks: TypstBlockNode[] }
    | { type: 'note'; children?: TypstInlineNode[]; blocks?: TypstBlockNode[] }
    | { type: 'unknown'; sourceType?: string; blocks?: TypstBlockNode[]; fallback?: string };

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
    assetPath(asset: Asset): string | undefined;
    convertMath?: (source: string, notation: string, display: boolean) => string | undefined;
    projectedMessages?: MessageNode[];
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

function safeJsonStringify(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    try {
        const text = JSON.stringify(value, null, 2);
        return typeof text === 'string' ? text : undefined;
    } catch {
        return undefined;
    }
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
        case 'strikethrough': {
            diagnostics.push({ severity: 'warning', code: 'TYPST_STRIKETHROUGH_DROPPED', message: 'Strikethrough formatting is not supported by the Typst transport; rendering plain text.', path });
            return { type: 'text', text: node.children.map(n => plainInline([n], new Map())).join('') };
        }
        case 'inlineCode': return { type: 'inlineCode', text: node.code };
        case 'link': return { type: 'link', url: node.href, children: node.children.map(n => renderInline(n, assets, citations, options, diagnostics, path)) };
        case 'image': {
            const asset = assets.get(node.assetId);
            const assetPath = asset ? options.assetPath(asset) : undefined;
            if (!asset || !assetPath) {
                diagnostics.push({ severity: 'warning', code: 'TYPST_V8_INLINE_IMAGE_MISSING', message: `Inline image asset ${node.assetId} unavailable to Typst; showing alt text.`, path });
                return { type: 'text', text: node.alt ?? asset?.name ?? `[image: ${node.assetId}]` };
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
    const sub = (child: BlockNode, index: number, tag: string): TypstBlockNode | null =>
        renderBlock(child, assets, citationLabels, citations, options, diagnostics, `${path}/${tag}:${index}`);
    switch (block.type) {
        case 'paragraph': return { type: 'paragraph', children: inline(block.children) };
        case 'heading': {
            const level = Math.min(block.level, 3) as 1 | 2 | 3;
            if (block.level > 3) diagnostics.push({ severity: 'warning', code: 'TYPST_V8_HEADING_CLAMP', message: `Heading level ${block.level} rendered as level 3.`, path });
            return { type: 'heading', level, children: inline(block.children) };
        }
        case 'list': {
            const items: TypstListItem[] = [];
            block.items.forEach((item, index) => {
                const kids: TypstBlockNode[] = [];
                item.blocks.forEach((child, childIndex) => {
                    const rendered = sub(child, childIndex, `list:${index}`);
                    if (rendered) kids.push(rendered);
                });
                items.push({ blocks: kids });
            });
            return {
                type: 'list',
                ordered: block.ordered,
                ...(block.start !== undefined ? { start: block.start } : {}),
                items,
            };
        }
        case 'quote': {
            const kids: TypstBlockNode[] = [];
            block.blocks.forEach((child, index) => {
                const rendered = sub(child, index, 'quote');
                if (rendered) kids.push(rendered);
            });
            return { type: 'quote', blocks: kids };
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
            const plainCitations = new Map([...citations.entries()].map(([k, v]) => [k, v.label]));
            return {
                type: 'table',
                headers,
                rows: block.rows.map(row => row.cells.map(cell => inline(cell.children))),
                ...(aligns && aligns.length ? { aligns } : {}),
                ...(block.caption?.length ? { caption: plainInline(block.caption, plainCitations) } : {}),
            };
        }
        case 'image': {
            const asset = assets.get(block.assetId);
            const assetPath = asset ? options.assetPath(asset) : undefined;
            if (!asset || !assetPath) {
                diagnostics.push({ severity: 'warning', code: 'TYPST_V8_IMAGE_MISSING', message: `Image asset ${block.assetId} unavailable to Typst.`, path });
                return { type: 'unknown', sourceType: 'missing-image', fallback: block.alt ?? asset?.name ?? `Missing image: ${block.assetId}` };
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
            const kids: TypstBlockNode[] = [];
            block.blocks.forEach((child, index) => {
                const rendered = sub(child, index, 'thought');
                if (rendered) kids.push(rendered);
            });
            return { type: 'note', blocks: kids };
        }
        case 'toolCall':
        case 'toolResult': {
            const kids: TypstBlockNode[] = [];
            const label = block.type === 'toolCall'
                ? `Tool call: ${block.toolName}`
                : `Tool result: ${block.toolName ?? block.callId}`;
            kids.push({ type: 'paragraph', children: [{ type: 'text', text: label }] });
            (block.displayBlocks ?? []).forEach((child, index) => {
                const rendered = sub(child, index, block.type);
                if (rendered) kids.push(rendered);
            });
            const raw = block.type === 'toolCall' ? block.input : block.output;
            const json = safeJsonStringify(raw);
            if (json) {
                kids.push({ type: 'code', language: 'json', text: json });
            } else if (raw !== undefined) {
                diagnostics.push({ severity: 'warning', code: 'TYPST_TOOL_PAYLOAD_FLATTENED', message: 'Tool input/output could not be serialized; omitting structured payload.', path });
            }
            return { type: 'note', blocks: kids };
        }
        case 'thematicBreak': return { type: 'paragraph', children: [{ type: 'text', text: '—' }] };
        case 'unknown': {
            if (block.fallbackBlocks) {
                const kids: TypstBlockNode[] = [];
                block.fallbackBlocks.forEach((child, index) => {
                    const rendered = sub(child, index, 'unknown');
                    if (rendered) kids.push(rendered);
                });
                return { type: 'unknown', sourceType: block.sourceType, blocks: kids };
            }
            return { type: 'unknown', sourceType: block.sourceType, fallback: 'Content preserved in archive but unavailable in this renderer.' };
        }
    }
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

    // Only emit trailing attachments for associated assets not already placed inline or as a block in the message.
    const referencedIds = collectReferencedAssetIds(message.blocks);
    const trailingImageIds = collectUnplacedAssociatedImageIds(
        message, referencedIds, (id) => assets.get(id)?.kind,
    );
    const attachments: TypstRenderAttachment[] = [];
    for (const id of message.associatedAssetIds ?? []) {
        if (referencedIds.has(id)) continue;
        const asset = assets.get(id);
        if (!asset) continue;
        if (trailingImageIds.has(id)) {
            const path = options.assetPath(asset);
            if (path) {
                attachments.push({ type: 'image', asset: path, name: asset.name ?? id, meta: `${mimeLabel(asset)} · ${humanBytes(asset.sizeBytes)}` });
            } else {
                diagnostics.push({
                    severity: 'warning',
                    code: 'TYPST_V8_ASSOCIATED_IMAGE_MISSING',
                    message: `Associated image asset ${id} has no Typst path; dropping the trailing image attachment instead of rendering it.`,
                    path: `message:${message.id}/attachment:${id}`,
                });
            }
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

    const messages = (options.projectedMessages ?? projectConversation(bundle, { leafMessageId: options.leafMessageId }).messages)
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
