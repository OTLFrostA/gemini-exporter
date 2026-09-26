/**
 * src/core/export/canonical/normalizeGemini.ts
 * F2b: Gemini provider normalizer — repo Conversation -> CanonicalConversationBundle.
 *
 * Implements ProviderNormalizer<Conversation> (see normalizer.ts). Markdown body
 * parsing mirrors the exact subset renderMarkdownToHtml() recognizes
 * (src/core/engine/template/htmlTemplate.ts); bodies are cleaned with the same
 * convertHtmlToMarkdown + stripInternalChipMarkdown pass the HTML exporter uses.
 *
 * Mapping decisions (F2b):
 * - thoughts/thinking -> ThoughtBlock{disclosure:'providerExposed',kind:'reasoning'};
 *   view state (initiallyCollapsed) stays in renderer config, never canonical.
 * - citations {url,title} -> Citation entities + trailing CitationGroupBlock;
 *   inline [n] markers become citationRef (label preserved).
 * - attachments/images/documents merged with the same dedupe rule as the HTML
 *   exporter's normalizeAttachments(); kind by mime/type; status honest:
 *   inline bytes or a real local file -> 'available', URL only -> 'remote',
 *   nothing usable -> 'missing' + diagnostic. A localName that is really a
 *   remote URL is treated as remote (pseudo-available guard).
 * - title candidates -> resolveTitle() (titleAuthority.ts); unknown source
 *   coerced to 'default' with a diagnostic, raw kept in observation.
 * - accountId: F1 owns it; never synthesized here (defaults to '').
 * - Unrecognized content -> unknown/unknownInline with readable fallback;
 *   nothing is silently dropped. Message tree self-checked via
 *   projectConversation(); structural failure becomes a diagnostic, never a throw.
 */

import { convertHtmlToMarkdown } from '../../engine/formatters/htmlConverter.js';
import { stripInternalChipMarkdown } from '../../utils/chipUtils.js';
import type {
    Attachment as RepoAttachment,
    ChatMessage as RepoMessage,
    Conversation as RepoConversation,
    TitleSource,
} from '../../../types/conversation.js';
import type { Asset, AssetKind, AssetStatus } from './assets.js';
import { classifyAssetAvailability } from './assetResolution.js';
import type { BlockNode } from './blocks.js';
import type { Citation } from './citations.js';
import type {
    CanonicalConversationBundle,
    CanonicalTitleSource,
    ConversationTitle,
    MessageNode,
    MessageRole,
    TitleCandidate,
} from './conversation.js';
import type { Diagnostic } from './diagnostics.js';
import type { InlineNode } from './inline.js';
import type { JsonValue } from './json.js';
import type {
    NormalizationContext,
    NormalizationResult,
    ProviderNormalizer,
} from './normalizer.js';
import { projectConversation, validateMessageTree } from './projection.js';
import type { SourceObservation, SourceRef } from './provenance.js';
import { resolveTitle } from './titleAuthority.js';
import { unknownBlockFallbackText } from './unknownFallback.js';
import { validateBundle } from './validate.js';

export interface GeminiNormalizationOptions {
    providerId?: string;
    /** TODO(F1): composite identity owns this. Never synthesize a colliding id. */
    accountId?: string;
    /** Observation time (not provider time). Defaults to now. */
    observedAt?: string;
    rawRef?: string;
}

const KNOWN_TITLE_SOURCES: ReadonlySet<string> = new Set([
    'rpc', 'api-detail', 'dom', 'takeout', 'sniff', 'legacy',
    'provider', 'user', 'derived', 'default',
]);

const KNOWN_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
    'id', 'role', 'content', 'timestamp', 'turnId', 'attachments', 'thoughts',
    'thinking', 'citations', 'images', 'documents', 'attachmentCount',
    'messageCount', 'sources',
]);

const KNOWN_CONVERSATION_FIELDS: ReadonlySet<string> = new Set([
    'id', 'title', 'timestamp', 'updatedAt', 'createdAt', 'chatTime', 'lastSeen',
    'lastActiveAt', 'source', 'titleSource', 'titles', 'messages', 'turns',
    'accountSlot', 'isTakeoutOnly', 'hitGoogleLimit', 'url', 'attachmentCount',
    'messageCount', 'href', 'hasExplicitPrompt',
]);

const URL_PROTOCOL_ALLOWLIST: ReadonlySet<string> = new Set(['http:', 'https:', 'blob:', 'data:']);

function cleanBody(text: unknown): string {
    if (typeof text !== 'string' || !text) return '';
    return stripInternalChipMarkdown(convertHtmlToMarkdown(text));
}

function toIso(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return undefined;
        if (/^-?\d+$/.test(s)) return toIso(Number(s));
        const t = Date.parse(s);
        return Number.isNaN(t) ? undefined : new Date(t).toISOString();
    }
    return undefined;
}

function isStr(v: unknown): v is string {
    return typeof v === 'string';
}

// ---------------------------------------------------------------- markdown ->

interface MdParser {
    inlineImageDowngrades: number;
}

let blockSeq = 0;
const nextBlockId = (prefix: string): string => `${prefix}-b${blockSeq++}`;

function parseInline(text: string, idPrefix: string, st: MdParser): InlineNode[] {
    const codeSpans: string[] = [];
    const mathSpans: string[] = [];
    let s = text.replace(/`([^`\n]+)`/g, (_m, code) => {
        codeSpans.push(code);
        return `\u0000C${codeSpans.length - 1}\u0000`;
    });
    s = s.replace(/(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g, (_m, formula) => {
        mathSpans.push(formula);
        return `\u0000M${mathSpans.length - 1}\u0000`;
    });

    const out: InlineNode[] = [];
    const pushText = (t: string): void => {
        if (t) out.push({ type: 'text', text: t });
    };
    // Split on protected spans, linked images, images, links; then emphasis per segment.
    // NOTE: the linked-image alternative must come before the standalone-image
    // one, otherwise [![alt](src)](href) would be cut after the inner ](src).
    const tokenRe = /\u0000[CM]\d+\u0000|\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)|!?\[[^\]]*\]\([^)]+\)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    const flushEmphasis = (seg: string): void => {
        for (const n of parseEmphasis(seg)) out.push(n);
    };
    while ((m = tokenRe.exec(s)) !== null) {
        flushEmphasis(s.slice(last, m.index));
        const tok = m[0];
        if (tok.startsWith('\u0000C')) {
            out.push({ type: 'inlineCode', code: codeSpans[Number(tok.slice(2, -1))] ?? '' });
        } else if (tok.startsWith('\u0000M')) {
            out.push({ type: 'inlineMath', source: mathSpans[Number(tok.slice(2, -1))] ?? '', notation: 'latex' });
        } else if (tok.startsWith('[![')) {
            const lim = tok.match(/^\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)$/);
            const lalt = lim ? lim[1] : '';
            const lsrc = lim ? lim[2].trim() : '';
            const lhref = lim ? lim[3].trim() : '';
            st.inlineImageDowngrades++;
            out.push({
                type: 'link',
                href: lhref,
                children: [{
                    type: 'unknownInline',
                    sourceType: 'inline-image',
                    fallbackText: lalt.trim() || '[image]',
                    rawRef: lsrc || undefined,
                }],
            });
        } else if (tok.startsWith('![')) {
            const im = tok.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
            const alt = im ? im[1] : '';
            const src = im ? im[2].trim() : '';
            st.inlineImageDowngrades++;
            out.push({
                type: 'unknownInline',
                sourceType: 'inline-image',
                fallbackText: alt.trim() || '[image]',
                rawRef: src || undefined,
            });
        } else {
            const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            if (lm) {
                out.push({
                    type: 'link',
                    href: lm[2].trim(),
                    children: parseEmphasis(lm[1]),
                });
            } else {
                flushEmphasis(tok);
            }
        }
        last = m.index + tok.length;
    }
    flushEmphasis(s.slice(last));
    return out;
}

function parseEmphasis(seg: string): InlineNode[] {
    if (!seg) return [];
    // Order mirrors formatInlineMarkdown(): *** / ___, ** / __, * / _, ~~.
    const patterns: Array<{ re: RegExp; make: (inner: InlineNode[]) => InlineNode }> = [
        { re: /\*\*\*([^*]+)\*\*\*/, make: (c) => ({ type: 'strong', children: [{ type: 'emphasis', children: c }] }) },
        { re: /___([^_]+)___/, make: (c) => ({ type: 'strong', children: [{ type: 'emphasis', children: c }] }) },
        { re: /\*\*([^*]+)\*\*/, make: (c) => ({ type: 'strong', children: c }) },
        { re: /__([^_]+)__/, make: (c) => ({ type: 'strong', children: c }) },
        { re: /\*([^*]+)\*/, make: (c) => ({ type: 'emphasis', children: c }) },
        { re: /_([^_]+)_/, make: (c) => ({ type: 'emphasis', children: c }) },
        { re: /~~([^~]+)~~/, make: (c) => ({ type: 'strikethrough', children: c }) },
    ];
    for (const { re, make } of patterns) {
        const idx = seg.search(re);
        if (idx >= 0) {
            const mt = re.exec(seg.slice(idx))!;
            return [
                ...parseEmphasis(seg.slice(0, idx)),
                make(parseEmphasis(mt[1])),
                ...parseEmphasis(seg.slice(idx + mt[0].length)),
            ];
        }
    }
    return [{ type: 'text', text: seg }];
}

function isTableSeparator(line: string): boolean {
    const t = line.trim();
    if (!t.includes('|')) return false;
    const parts = t.split('|').map((p) => p.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    return parts.length > 0 && parts.every((p) => /^:?-+:?$/.test(p));
}

function parseTableRow(line: string): string[] {
    let c = line.trim();
    if (c.startsWith('|')) c = c.slice(1);
    if (c.endsWith('|')) c = c.slice(0, -1);
    return c.split('|').map((x) => x.trim());
}

function tableAlignments(sepLine: string): Array<'left' | 'center' | 'right' | 'default'> {
    const t = sepLine.trim();
    let c = t.startsWith('|') ? t.slice(1) : t;
    c = c.endsWith('|') ? c.slice(0, -1) : c;
    return c.split('|').map((p) => {
        const x = p.trim();
        if (x.startsWith(':') && x.endsWith(':')) return 'center';
        if (x.endsWith(':')) return 'right';
        if (x.startsWith(':')) return 'left';
        return 'default';
    });
}

function parseList(lines: string[], i: number, idPrefix: string, st: MdParser): { nodes: BlockNode[]; next: number } {
    interface RawItem { indent: number; ordered: boolean; num: number; text: string; }
    const items: RawItem[] = [];
    let j = i;
    while (j < lines.length) {
        const lm = lines[j].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!lm) break;
        items.push({
            indent: lm[1].replace(/\t/g, '    ').length,
            ordered: /^\d+\.$/.test(lm[2]),
            num: parseInt(lm[2], 10) || 1,
            text: lm[3],
        });
        j++;
        while (j < lines.length && /^\s+\S/.test(lines[j]) && !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[j])) {
            items[items.length - 1].text += ' ' + lines[j].trim();
            j++;
        }
    }
    // Recursive indent-based build. Every scanned item lands in exactly one
    // list; a marker-type change at the same indent starts a sibling list.
    const buildAt = (start: number, levelIndent: number): { nodes: BlockNode[]; next: number } => {
        const nodes: BlockNode[] = [];
        let k = start;
        while (k < items.length && items[k].indent >= levelIndent) {
            if (items[k].indent > levelIndent) {
                // Defensive: deeper item with no parent at this level (no loss).
                const nested = buildAt(k, items[k].indent);
                const lastNode = nodes[nodes.length - 1];
                if (lastNode && lastNode.type === 'list') {
                    const li = lastNode.items;
                    li[li.length - 1].blocks.push(...nested.nodes);
                } else {
                    nodes.push(...nested.nodes);
                }
                k = nested.next;
                continue;
            }
            const ordered = items[k].ordered;
            const listItems: Array<{ blocks: BlockNode[] }> = [];
            let startNum = 1;
            let first = true;
            while (k < items.length && items[k].indent === levelIndent && items[k].ordered === ordered) {
                if (first) { startNum = items[k].num; first = false; }
                const blocks: BlockNode[] = [{
                    id: nextBlockId(idPrefix),
                    type: 'paragraph',
                    children: parseInline(items[k].text, idPrefix, st),
                }];
                k++;
                if (k < items.length && items[k].indent > levelIndent) {
                    const nested = buildAt(k, items[k].indent);
                    blocks.push(...nested.nodes);
                    k = nested.next;
                }
                listItems.push({ blocks });
            }
            nodes.push({
                id: nextBlockId(idPrefix),
                type: 'list',
                ordered,
                start: ordered ? startNum : undefined,
                items: listItems,
            });
        }
        return { nodes, next: k };
    };
    const { nodes } = buildAt(0, items[0]?.indent ?? 0);
    return { nodes, next: j };
}

function parseMarkdownBlocks(markdown: string, idPrefix: string, st: MdParser): BlockNode[] {
    const lines = markdown.split('\n');
    const blocks: BlockNode[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) { i++; continue; }

        if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
            const fenceChar = trimmed[0];
            const fm = trimmed.match(new RegExp(`^(\\${fenceChar}{3,})(.*)$`));
            const fenceLen = fm ? fm[1].length : 3;
            const info = (fm ? fm[2] : '').trim();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length) {
                if (lines[i].trim().startsWith(fenceChar.repeat(fenceLen))) { i++; break; }
                codeLines.push(lines[i]);
                i++;
            }
            const langTok = info.split(/\s+/).filter(Boolean);
            blocks.push({
                id: nextBlockId(idPrefix),
                type: 'code',
                code: codeLines.join('\n'),
                language: langTok[0] || undefined,
                meta: langTok.length > 1 ? langTok.slice(1).join(' ') : undefined,
            });
            continue;
        }

        if (trimmed.startsWith('$$')) {
            const mathLines: string[] = [];
            if (trimmed.length > 2 && trimmed.endsWith('$$') && trimmed !== '$$') {
                mathLines.push(trimmed.slice(2, -2).trim());
                i++;
            } else {
                i++;
                while (i < lines.length) {
                    const cur = lines[i].trim();
                    if (cur === '$$' || cur.endsWith('$$')) {
                        if (cur !== '$$') mathLines.push(cur.replace(/\$\$$/, '').trim());
                        i++;
                        break;
                    }
                    mathLines.push(lines[i]);
                    i++;
                }
            }
            blocks.push({ id: nextBlockId(idPrefix), type: 'math', source: mathLines.join('\n'), notation: 'latex' });
            continue;
        }

        if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            const headerCells = parseTableRow(line);
            const aligns = tableAlignments(lines[i + 1]);
            i += 2;
            const bodyRows: string[][] = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                bodyRows.push(parseTableRow(lines[i]));
                i++;
            }
            const cell = (t: string): { children: InlineNode[] } => ({ children: parseInline(t, idPrefix, st) });
            blocks.push({
                id: nextBlockId(idPrefix),
                type: 'table',
                columns: headerCells.map((_, c) => ({ align: aligns[c] ?? 'default' })),
                headerRows: [{ cells: headerCells.map(cell) }],
                rows: bodyRows.map((r) => ({
                    cells: headerCells.map((_, c) => cell(r[c] ?? '')),
                })),
            });
            continue;
        }

        const hm = line.match(/^(#{1,6})\s+(.*)$/);
        if (hm) {
            blocks.push({
                id: nextBlockId(idPrefix),
                type: 'heading',
                level: hm[1].length as 1 | 2 | 3 | 4 | 5 | 6,
                children: parseInline(hm[2].trim(), idPrefix, st),
            });
            i++;
            continue;
        }

        if (trimmed.startsWith('>')) {
            const bqLines: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                bqLines.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            blocks.push({
                id: nextBlockId(idPrefix),
                type: 'quote',
                blocks: parseMarkdownBlocks(bqLines.join('\n'), idPrefix, st),
            });
            continue;
        }

        if (/^([-*_]){3,}$/.test(trimmed)) {
            blocks.push({ id: nextBlockId(idPrefix), type: 'thematicBreak' });
            i++;
            continue;
        }

        if (/^(\s*)([-*+]|\d+\.)\s+/.test(line)) {
            const { nodes, next } = parseList(lines, i, idPrefix, st);
            blocks.push(...nodes);
            i = next;
            continue;
        }

        const pLines: string[] = [];
        while (i < lines.length) {
            const cur = lines[i];
            const ct = cur.trim();
            if (!ct) break;
            if (ct.startsWith('```') || ct.startsWith('~~~') || ct.startsWith('$$') ||
                (ct.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) ||
                /^#{1,6}\s/.test(cur) || ct.startsWith('>') || /^([-*_]){3,}$/.test(ct) ||
                /^(\s*)([-*+]|\d+\.)\s+/.test(cur)) break;
            pLines.push(cur);
            i++;
        }
        if (pLines.length) {
            const children: InlineNode[] = [];
            pLines.forEach((pl, idx) => {
                if (idx > 0) children.push({ type: 'lineBreak', kind: 'soft' });
                children.push(...parseInline(pl, idPrefix, st));
            });
            blocks.push({ id: nextBlockId(idPrefix), type: 'paragraph', children });
        }
    }
    return blocks;
}

// ---------------------------------------------------------------- attachments

interface MergedAttachment extends RepoAttachment {
    __origin: 'attachment' | 'image' | 'document';
}

function mergeMessageAttachments(m: RepoMessage): MergedAttachment[] {
    const atts: MergedAttachment[] = [];
    const push = (a: RepoAttachment, origin: MergedAttachment['__origin']): void => {
        if (!a || typeof a !== 'object') return;
        const key = a.localName || a.url || a.sourceUrl || a.resolvedUrl || a.src;
        if (key && atts.some((x) => (x.localName || x.url || x.sourceUrl || x.resolvedUrl || x.src) === key)) return;
        atts.push({ ...a, __origin: origin });
    };
    for (const a of m.attachments ?? []) push(a, 'attachment');
    for (const img of m.images ?? []) push({ ...img, type: img.type || 'image' }, 'image');
    for (const doc of (m.documents ?? []) as RepoAttachment[]) push({ ...doc, type: doc.type || 'file' }, 'document');
    return atts;
}

function attachmentDisplayName(a: RepoAttachment, isImage: boolean): string {
    return a.title || a.name || a.fileName || a.localName?.split('/').pop() || (isImage ? 'image.jpg' : 'file');
}

function classifyAttachmentKind(a: RepoAttachment): { kind: AssetKind; isImage: boolean; diag?: string } {
    const mime = (a.mimeType || a.mime || '').toLowerCase();
    const name = attachmentDisplayName(a, false);
    const isImage = a.type === 'image' || a.isImage === true ||
        mime.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i.test(name);
    if (isImage) return { kind: 'image', isImage: true };
    if (mime.startsWith('audio/')) return { kind: 'audio', isImage: false };
    if (mime.startsWith('video/')) return { kind: 'video', isImage: false };
    if (a.type === 'file' || a.type === 'doc' || a.type === 'code' || mime) return { kind: 'file', isImage: false };
    return {
        kind: 'other',
        isImage: false,
        diag: `unrecognized attachment type '${String(a.type)}'; mapped to kind 'other'`,
    };
}

function normalizeLocalName(localName: string): string {
    let loc = localName;
    if (loc && !loc.startsWith('assets/') && !/^https?:\/\//i.test(loc)) loc = `assets/${loc}`;
    return loc;
}

interface AssetBuild {
    asset: Asset;
    diagnostics: Diagnostic[];
    isImage: boolean;
    origin: 'inline' | 'attachment' | 'generated' | 'unknown';
}

function buildAsset(
    a: RepoAttachment,
    id: string,
    sourceRef: SourceRef,
    origin: AssetBuild['origin'],
): AssetBuild {
    const diagnostics: Diagnostic[] = [];
    const { kind, isImage, diag } = classifyAttachmentKind(a);
    if (diag) {
        diagnostics.push({
            id: `asset-kind:${id}`,
            severity: 'info',
            code: 'ASSET_KIND_FALLBACK',
            message: diag,
            sourceRef,
            details: { rawType: String(a.type ?? null) } as JsonValue,
        });
    }
    const rawLocal = a.localName || '';
    const localIsUrl = /^https?:\/\//i.test(rawLocal);
    const hasInlineBytes = !!(a.dataBuffer || a.blobBase64 || a.dataBase64);
    const hasLocalFile = !!rawLocal && !localIsUrl;
    const url = a.resolvedUrl || a.sourceUrl || a.url || a.src || (localIsUrl ? rawLocal : undefined);

    let status: AssetStatus;
    let storageRef: string | undefined;
    let sourceUrl: string | undefined;
    if (hasInlineBytes || hasLocalFile) {
        status = 'available';
        if (hasLocalFile) storageRef = normalizeLocalName(rawLocal);
        if (url) sourceUrl = url;
    } else if (url) {
        status = 'remote';
        sourceUrl = url;
        if (localIsUrl) {
            diagnostics.push({
                id: `asset-pseudo-local:${id}`,
                severity: 'info',
                code: 'PSEUDO_LOCAL_URL',
                message: `attachment localName is a remote URL; treating as remote, not local`,
                sourceRef,
                details: { localName: rawLocal } as JsonValue,
            });
        }
    } else {
        status = 'missing';
        diagnostics.push({
            id: `asset-no-source:${id}`,
            severity: 'warning',
            code: 'ATTACHMENT_NO_SOURCE',
            message: `attachment has no usable bytes, local file or URL; marked missing`,
            sourceRef,
            details: { rawType: String(a.type ?? null) } as JsonValue,
        });
    }

    const asset: Asset = {
        id,
        kind,
        name: attachmentDisplayName(a, isImage),
        mimeType: a.mimeType || a.mime || undefined,
        sizeBytes: typeof a.size === 'number' ? a.size : undefined,
        dimensions: typeof a.width === 'number' && typeof a.height === 'number'
            ? { widthPx: a.width, heightPx: a.height }
            : undefined,
        sourceUrl,
        storageRef,
        status,
        failureReason: status === 'missing' ? 'no usable bytes, local file or URL in attachment record' : undefined,
        sourceRef,
        extensions: a.type ? { gemini: { attachmentType: String(a.type) } as JsonValue } : undefined,
    };
    const classified = classifyAssetAvailability(asset, hasInlineBytes || hasLocalFile);
    if (classified.diagnostic) diagnostics.push(classified.diagnostic);
    return { asset, diagnostics, isImage, origin };
}

// ---------------------------------------------------------------- citations

interface RawCitation {
    url?: string;
    title?: string;
}

function extractRawCitations(m: RepoMessage): { list: RawCitation[]; skipped: number } {
    const list: RawCitation[] = [];
    let skipped = 0;
    const push = (c: RawCitation): void => {
        if (c.url && !list.some((x) => x.url === c.url)) list.push(c);
        else if (!c.url) skipped++;
    };
    const fromCitations = m.citations;
    if (Array.isArray(fromCitations)) {
        for (const c of fromCitations) {
            if (c && typeof c === 'object' && isStr((c as { url?: unknown }).url)) {
                const o = c as { url: string; title?: unknown };
                push({ url: o.url, title: isStr(o.title) ? o.title : undefined });
            } else skipped++;
        }
    }
    const fromSources = m.sources;
    if (Array.isArray(fromSources)) {
        for (const s of fromSources) {
            if (isStr(s)) push({ url: s });
            else if (s && typeof s === 'object' && isStr((s as { url?: unknown }).url)) {
                const o = s as { url: string; title?: unknown };
                push({ url: o.url, title: isStr(o.title) ? o.title : undefined });
            } else skipped++;
        }
    }
    return { list, skipped };
}

/** Replace [n] markers in text inlines with citationRef when they resolve. */
function linkCitationMarkers(blocks: BlockNode[], citations: Citation[]): void {
    if (!citations.length) return;
    const byIndex = new Map(citations.map((c, i) => [i + 1, c]));
    const walkInline = (nodes: InlineNode[]): InlineNode[] => {
        const out: InlineNode[] = [];
        for (const n of nodes) {
            if (n.type === 'text') {
                const re = /\[(\d+)\]/g;
                let last = 0;
                let mt: RegExpExecArray | null;
                let replaced = false;
                while ((mt = re.exec(n.text)) !== null) {
                    const cit = byIndex.get(Number(mt[1]));
                    if (!cit) continue;
                    replaced = true;
                    if (mt.index > last) out.push({ type: 'text', text: n.text.slice(last, mt.index) });
                    out.push({ type: 'citationRef', citationId: cit.id, label: mt[0] });
                    last = mt.index + mt[0].length;
                }
                if (replaced) {
                    if (last < n.text.length) out.push({ type: 'text', text: n.text.slice(last) });
                } else {
                    out.push(n);
                }
            } else if ((n.type === 'strong' || n.type === 'emphasis' || n.type === 'strikethrough' || n.type === 'link')) {
                out.push({ ...n, children: walkInline(n.children) });
            } else {
                out.push(n);
            }
        }
        return out;
    };
    const walkBlock = (b: BlockNode): void => {
        switch (b.type) {
            case 'paragraph':
            case 'heading':
                (b as { children: InlineNode[] }).children = walkInline((b as { children: InlineNode[] }).children);
                break;
            case 'quote':
            case 'thought':
                b.blocks.forEach(walkBlock);
                break;
            case 'list':
                b.items.forEach((it) => it.blocks.forEach(walkBlock));
                break;
            case 'table': {
                const rows = [...(b.headerRows ?? []), ...b.rows];
                for (const r of rows) for (const c of r.cells) c.children = walkInline(c.children);
                break;
            }
            case 'citationGroup':
                if (b.title) b.title = walkInline(b.title);
                break;
            default:
                break;
        }
    };
    blocks.forEach(walkBlock);
}

// ---------------------------------------------------------------- messages

function mapRole(role: unknown): { role: MessageRole; rawRole?: string } {
    if (role === 'user') return { role: 'user' };
    if (role === 'model' || role === 'assistant') return { role: 'assistant' };
    if (role === 'system') return { role: 'system' };
    return { role: 'unknown', rawRole: isStr(role) ? role : undefined };
}

interface MessageBuild {
    node: MessageNode;
    assets: Asset[];
    citations: Citation[];
    diagnostics: Diagnostic[];
}

function normalizeMessage(
    m: RepoMessage,
    index: number,
    locator: string,
    ctx: { providerId: string; diag: Diagnostic[] },
): MessageBuild {
    const diagnostics: Diagnostic[] = [];
    const msgId = isStr(m.id) && m.id ? m.id : `msg-${index}`;
    if (msgId !== m.id) {
        diagnostics.push({
            id: `synth-id:${msgId}`,
            severity: 'info',
            code: 'SYNTHESIZED_MESSAGE_ID',
            message: `message at ${locator} had no id; assigned deterministic ${msgId}`,
        });
    }
    const sourceRef: SourceRef = {
        providerId: ctx.providerId,
        providerMessageId: isStr(m.id) ? m.id : undefined,
        locator,
    };
    const { role, rawRole } = mapRole(m.role);
    if (role === 'unknown') {
        diagnostics.push({
            id: `unknown-role:${msgId}`,
            severity: 'info',
            code: 'UNKNOWN_ROLE',
            message: `unrecognized role mapped to 'unknown'`,
            sourceRef,
            details: { rawRole: rawRole ?? null } as JsonValue,
        });
    }

    const idPrefix = msgId;
    const st: MdParser = { inlineImageDowngrades: 0 };
    const blocks: BlockNode[] = [];

    const thoughtsRaw = m.thoughts ?? m.thinking ?? '';
    const thoughtsText = cleanBody(Array.isArray(thoughtsRaw) ? thoughtsRaw.join('\n\n') : thoughtsRaw);
    if (thoughtsText.trim()) {
        blocks.push({
            id: nextBlockId(idPrefix),
            type: 'thought',
            disclosure: 'providerExposed',
            kind: 'reasoning',
            blocks: parseMarkdownBlocks(thoughtsText, idPrefix, st),
        });
    }

    if (typeof m.content === 'string') {
        const cleaned = cleanBody(m.content);
        if (cleaned.trim()) blocks.push(...parseMarkdownBlocks(cleaned, idPrefix, st));
    } else if (m.content !== undefined && m.content !== null) {
        const ub: BlockNode = {
            id: nextBlockId(idPrefix),
            type: 'unknown',
            sourceType: 'message-content',
            payload: m.content as JsonValue,
        };
        blocks.push(ub);
        diagnostics.push({
            id: `unknown-content:${msgId}`,
            severity: 'warning',
            code: 'UNKNOWN_MESSAGE_CONTENT',
            message: `message content was not a string; preserved as unknown block`,
            sourceRef,
            details: { fallback: unknownBlockFallbackText(ub) } as JsonValue,
        });
    }

    const assets: Asset[] = [];
    const assetIds: string[] = [];
    const merged = mergeMessageAttachments(m);
    merged.forEach((a, ai) => {
        const assetId = `${msgId}-a${ai}`;
        const built = buildAsset(a, assetId, { ...sourceRef, locator: `${locator}.attachments[${ai}]` },
            a.isGenerated ? 'generated' : a.__origin === 'attachment' ? 'attachment' : a.__origin === 'image' ? 'inline' : 'unknown');
        assets.push(built.asset);
        assetIds.push(assetId);
        diagnostics.push(...built.diagnostics);
        const bid = nextBlockId(idPrefix);
        if (built.isImage) {
            blocks.push({
                id: bid, type: 'image', assetId,
                alt: built.asset.name, origin: built.origin,
                sourceRef,
            });
        } else {
            blocks.push({
                id: bid, type: 'file', assetId,
                label: built.asset.name, origin: built.origin,
                sourceRef,
            });
        }
    });

    const citations: Citation[] = [];
    const { list: rawCits, skipped } = extractRawCitations(m);
    if (skipped > 0) {
        diagnostics.push({
            id: `citation-skipped:${msgId}`,
            severity: 'info',
            code: 'CITATION_SKIPPED',
            message: `${skipped} citation/source entries had no usable URL and were skipped`,
            sourceRef,
        });
    }
    rawCits.forEach((rc, ci) => {
        const cid = `${msgId}-cit${ci}`;
        let kind: Citation['kind'] = 'web';
        if (!rc.url) kind = 'other';
        else if (!/^https?:\/\//i.test(rc.url)) kind = 'other';
        citations.push({
            id: cid,
            kind,
            url: rc.url,
            title: rc.title,
            sourceRef: { ...sourceRef, locator: `${locator}.citations[${ci}]` },
        });
    });
    if (citations.length) {
        linkCitationMarkers(blocks, citations);
        blocks.push({
            id: nextBlockId(idPrefix),
            type: 'citationGroup',
            citationIds: citations.map((c) => c.id),
            sourceRef,
        } as BlockNode);
    }

    if (st.inlineImageDowngrades > 0) {
        diagnostics.push({
            id: `inline-image:${msgId}`,
            severity: 'info',
            code: 'INLINE_IMAGE_DOWNGRADE',
            message: `${st.inlineImageDowngrades} inline markdown image(s) mapped to unknownInline with readable fallback`,
            sourceRef,
        });
    }

    const unknownFields = Object.keys(m ?? {}).filter((k) => !KNOWN_MESSAGE_FIELDS.has(k));
    const node: MessageNode = {
        id: msgId,
        role,
        author: rawRole ? { rawRole } : undefined,
        createdAt: toIso(m.timestamp),
        blocks,
        associatedAssetIds: assetIds.length ? assetIds : undefined,
        sourceRef,
        extensions: unknownFields.length
            ? { gemini: { unknownFields } as JsonValue }
            : undefined,
    };
    return { node, assets, citations, diagnostics };
}

// ---------------------------------------------------------------- titles

function normalizeTitle(raw: RepoConversation, diagnostics: Diagnostic[]): ConversationTitle | undefined {
    const candidates: TitleCandidate[] = [];
    const titles = raw.titles;
    if (titles && typeof titles === 'object') {
        for (const [src, val] of Object.entries(titles)) {
            if (isStr(val) && val.trim()) {
                candidates.push({ value: val.trim(), source: src as CanonicalTitleSource });
            }
        }
    }
    if (isStr(raw.title) && raw.title.trim()) {
        const rawSource = raw.titleSource;
        const source: CanonicalTitleSource = isStr(rawSource) && KNOWN_TITLE_SOURCES.has(rawSource)
            ? (rawSource as CanonicalTitleSource)
            : 'default';
        if (isStr(rawSource) && !KNOWN_TITLE_SOURCES.has(rawSource)) {
            diagnostics.push({
                id: 'title-source-coerced',
                severity: 'info',
                code: 'TITLE_SOURCE_COERCED',
                message: `unrecognized titleSource '${rawSource}' coerced to 'default'; raw kept in observation`,
            });
        }
        if (!candidates.some((c) => c.value === raw.title.trim() && c.source === source)) {
            candidates.push({ value: raw.title.trim(), source });
        }
    }
    if (!candidates.length) return undefined;
    return resolveTitle(candidates);
}

// ---------------------------------------------------------------- entry

function observationSourceType(source: unknown): SourceObservation['sourceType'] {
    if (isStr(source)) {
        const s = source.toLowerCase();
        if (s.includes('takeout')) return 'official-export';
        if (s.includes('live') || s.includes('rpc')) return 'live';
        if (s.includes('archive') || s.includes('import')) return 'archive-import';
        if (s.includes('legacy') || s.includes('migrat')) return 'legacy-migration';
    }
    return 'other';
}

export async function normalizeGeminiConversation(
    raw: RepoConversation,
    options: GeminiNormalizationOptions = {},
): Promise<NormalizationResult> {
    const providerId = options.providerId ?? 'gemini';
    const accountId = options.accountId ?? '';
    const observedAt = options.observedAt ?? new Date().toISOString();
    const diagnostics: Diagnostic[] = [];
    const assets: Asset[] = [];
    const citations: Citation[] = [];

    blockSeq = 0;

    const messages: MessageNode[] = [];
    const pushMessage = (m: RepoMessage, index: number, locator: string): void => {
        if (!m || typeof m !== 'object') {
            diagnostics.push({
                id: `bad-message:${locator}`,
                severity: 'warning',
                code: 'BAD_MESSAGE_SHAPE',
                message: `message at ${locator} is not an object; skipped`,
                sourceRef: { providerId, locator },
            });
            return;
        }
        const built = normalizeMessage(m, index, locator, { providerId, diag: diagnostics });
        messages.push(built.node);
        assets.push(...built.assets);
        citations.push(...built.citations);
        diagnostics.push(...built.diagnostics);
    };

    const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
    const rawTurns = Array.isArray(raw.turns) ? raw.turns : [];
    if (rawMessages.length) {
        rawMessages.forEach((m, i) => pushMessage(m, i, `messages[${i}]`));
    } else if (rawTurns.length) {
        let mi = 0;
        rawTurns.forEach((t, ti) => {
            if (!t || typeof t !== 'object') return;
            if (Array.isArray(t.messages) && t.messages.length) {
                t.messages.forEach((m, i) => pushMessage(m, mi++, `turns[${ti}].messages[${i}]`));
                return;
            }
            if (isStr(t.userContent) && t.userContent) {
                pushMessage({ role: 'user', content: t.userContent, timestamp: t.timestamp ?? undefined } as RepoMessage, mi++, `turns[${ti}].userContent`);
            }
            const hasModel = isStr(t.modelContent) && t.modelContent;
            if (hasModel || t.thoughts || (t.attachments?.length) || (t.images?.length) || (t.sources?.length)) {
                pushMessage({
                    role: 'model',
                    content: hasModel ? t.modelContent as string : '',
                    timestamp: t.timestamp ?? undefined,
                    thoughts: t.thoughts as string | string[] | undefined,
                    attachments: t.attachments as RepoAttachment[] | undefined,
                    images: t.images as RepoAttachment[] | undefined,
                    sources: t.sources as unknown[] | undefined,
                } as RepoMessage, mi++, `turns[${ti}].modelContent`);
            }
        });
    } else {
        diagnostics.push({
            id: 'no-messages',
            severity: 'warning',
            code: 'NO_MESSAGES',
            message: 'conversation has neither messages nor turns; bundle will be empty',
            sourceRef: { providerId, locator: 'messages' },
        });
    }

    const title = normalizeTitle(raw, diagnostics);

    const unknownFields = Object.keys(raw ?? {}).filter((k) => !KNOWN_CONVERSATION_FIELDS.has(k));
    const observation: SourceObservation = {
        id: 'obs-gemini-normalize',
        providerId,
        sourceType: observationSourceType(raw.source),
        observedAt,
        rawCount: rawMessages.length || rawTurns.length,
        parsedCount: messages.length,
        unknownFields: unknownFields.length ? unknownFields : undefined,
        rawRef: options.rawRef,
        extensions: {
            gemini: {
                source: isStr(raw.source) ? raw.source : null,
                accountSlot: isStr(raw.accountSlot) ? raw.accountSlot : null,
                isTakeoutOnly: raw.isTakeoutOnly ?? null,
                titleSource: isStr(raw.titleSource) ? raw.titleSource : null,
            } as JsonValue,
        },
    };

    const bundle: CanonicalConversationBundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId, accountId, conversationId: isStr(raw.id) ? raw.id : '' },
            title,
            createdAt: toIso(raw.createdAt ?? raw.timestamp ?? raw.chatTime),
            updatedAt: toIso(raw.updatedAt ?? raw.lastSeen),
            observedAt,
            messages,
            extensions: raw.url || raw.href
                ? { gemini: { url: (raw.url || raw.href) as string } as JsonValue }
                : undefined,
        },
        assets,
        citations,
        observations: [observation],
        diagnostics: diagnostics.length ? diagnostics : undefined,
    };

    // Structural self-check: our own output must project cleanly.
    try {
        const treeIssues = validateMessageTree(bundle.conversation);
        if (treeIssues.length) {
            diagnostics.push({
                id: 'selfcheck-tree',
                severity: 'error',
                code: 'SELFCHECK_TREE_INVALID',
                message: `normalizer produced an invalid message tree: ${treeIssues[0].message}`,
            });
        } else {
            projectConversation(bundle);
        }
    } catch (err) {
        diagnostics.push({
            id: 'selfcheck-project',
            severity: 'error',
            code: 'SELFCHECK_PROJECT_FAILED',
            message: `projectConversation self-check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
    // Canonical runtime validation: any contract violation in our own output
    // is a normalizer bug and must be visible, never silently accepted.
    try {
        const issues = validateBundle(bundle);
        for (const issue of issues) {
            if (issue.severity === 'error' && !diagnostics.some((d) => d.id === issue.id)) {
                diagnostics.push(issue);
            }
        }
    } catch (err) {
        diagnostics.push({
            id: 'selfcheck-validate',
            severity: 'error',
            code: 'SELFCHECK_VALIDATE_FAILED',
            message: `validateBundle self-check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
    if (diagnostics.length && !bundle.diagnostics) bundle.diagnostics = diagnostics;

    return { bundle, diagnostics };
}

export class GeminiNormalizer implements ProviderNormalizer<RepoConversation> {
    readonly providerId = 'gemini';
    private readonly options: GeminiNormalizationOptions;

    constructor(options: GeminiNormalizationOptions = {}) {
        this.options = options;
    }

    async normalize(raw: RepoConversation, context: NormalizationContext): Promise<NormalizationResult> {
        // Preserve the provider's original payload as raw evidence before
        // deriving anything from it. The returned logical ref is threaded
        // through as options.rawRef so it lands in the observation and can
        // be attached to sourceRefs/provenance downstream.
        let rawRef = this.options.rawRef;
        if (context.rawEvidence && !rawRef) {
            try {
                rawRef = await context.rawEvidence.put('gemini-conversation', raw);
            } catch {
                rawRef = this.options.rawRef;
            }
        }
        return normalizeGeminiConversation(raw, {
            ...this.options,
            rawRef,
            providerId: context.providerId || this.options.providerId,
            accountId: context.accountId,
            observedAt: context.observedAt,
        });
    }
}
