import { convertHtmlToMarkdown } from '../../engine/formatters/htmlConverter.js';
import { stripInternalChipMarkdown } from '../../utils/chipUtils.js';
import type {
    Attachment as RepoAttachment,
    ChatMessage as RepoMessage,
    Conversation as RepoConversation,
    TitleSource,
} from '../../../types/conversation.js';
import type { Asset, AssetKind, AssetStatus } from './assets.js';
import { decodeDataUrlAsset, createInlineByteStore } from '../assets/index.js';
import type { InlineByteStore } from '../assets/index.js';
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
import { CANONICAL_TITLE_SOURCES } from './conversation.js';
import type { Diagnostic } from './diagnostics.js';
import type { ImageInline, InlineNode } from './inline.js';
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
    accountId?: string;
    observedAt?: string;
    rawRef?: string;
}

export interface GeminiNormalizationResult extends NormalizationResult {
    byteStore: InlineByteStore;
}

function canonicalTitleSource(raw: unknown, diagnostics: Diagnostic[]): CanonicalTitleSource {
    if (isStr(raw) && CANONICAL_TITLE_SOURCES.has(raw)) {
        return raw as CanonicalTitleSource;
    }
    if (isStr(raw)) {
        diagnostics.push({
            id: 'title-source-coerced',
            severity: 'info',
            code: 'TITLE_SOURCE_COERCED',
            message: `unrecognized titleSource '${raw}' coerced to 'default'; raw kept in observation`,
        });
    }
    return 'default';
}

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

interface MdParser {
    diagnostics: Diagnostic[];
    sourceRef: SourceRef;
    assetIndex: AssetLinkIndex;
    inlineAssets: Asset[];
    idPrefix: string;
    byteStore: InlineByteStore;
    nextBlockId: () => string;
}

interface AssetLinkIndex {
    byRef: Map<string, string>;
    byBasename: Map<string, Set<string>>;
}

function newAssetLinkIndex(): AssetLinkIndex {
    return { byRef: new Map(), byBasename: new Map() };
}

function assetRefKeys(ref: string): string[] {
    const keys = [ref];
    const noPrefix = ref.replace(/^assets\//, '');
    if (noPrefix !== ref) keys.push(noPrefix);
    try {
        const decoded = decodeURIComponent(noPrefix);
        if (decoded !== noPrefix) keys.push(decoded);
    } catch {
    }
    return keys;
}

function assetBasename(ref: string): string | undefined {
    const noPrefix = ref.replace(/^assets\//, '');
    const base = noPrefix.split('/').pop() ?? '';
    return base && base !== noPrefix ? base : undefined;
}

function indexAssetRef(index: AssetLinkIndex, ref: string, assetId: string): void {
    for (const key of assetRefKeys(ref)) index.byRef.set(key, assetId);
    const base = assetBasename(ref);
    if (base) {
        let set = index.byBasename.get(base);
        if (!set) {
            set = new Set();
            index.byBasename.set(base, set);
        }
        set.add(assetId);
    }
}

function dataUrlPreview(url: string): string {
    const head = url.slice(0, 64);
    return url.length > 64 ? `${head}…(${url.length} chars total)` : head;
}

function linkInlineImage(src: string, alt: string, title: string | undefined, st: MdParser): ImageInline {
    const trimmedSrc = src.trim();
    for (const key of assetRefKeys(trimmedSrc)) {
        const hit = st.assetIndex.byRef.get(key);
        if (hit) {
            return makeImageInline(hit, alt, title);
        }
    }
    let ambiguous = false;
    const base = assetBasename(trimmedSrc) ?? trimmedSrc;
    if (base) {
        const candidates = st.assetIndex.byBasename.get(base);
        if (candidates && candidates.size === 1) {
            return makeImageInline([...candidates][0], alt, title);
        }
        if (candidates && candidates.size > 1) {
            ambiguous = true;
            const ids = [...candidates].sort();
            st.diagnostics.push({
                id: `inline-image-ambiguous:${ids.join(',')}`,
                severity: 'warning',
                code: 'AMBIGUOUS_INLINE_IMAGE_ASSET',
                message: `inline image '${trimmedSrc.slice(0, 120)}' basename '${base}' matches ${ids.length} attachments; refusing to bind an arbitrary one`,
                sourceRef: st.sourceRef,
                details: { src: trimmedSrc.slice(0, 200), assetIds: ids } as JsonValue,
            });
        }
    }
    const assetId = `${st.idPrefix}-img${st.inlineAssets.length}`;
    const fileBase = (trimmedSrc.split('/').pop() ?? '').split('?')[0];
    const altName = alt.trim();
    let name = altName || fileBase || 'image';
    let status: AssetStatus;
    let sourceUrl: string | undefined;
    let storageRef: string | undefined;
    let mimeType: string | undefined;
    let sizeBytes: number | undefined;
    let sha256: string | undefined;
    let failureReason: string | undefined;
    let dataUrlDiag: { code: 'DATA_URL_TOO_LARGE' | 'DATA_URL_MALFORMED'; message: string } | undefined;
    if (/^data:/i.test(trimmedSrc)) {
        // Omit sourceUrl so the raw data: URI payload is not duplicated in the serialized bundle.
        const decoded = decodeDataUrlAsset(trimmedSrc);
        if (decoded.ok) {
            status = 'available';
            storageRef = decoded.storageRef;
            mimeType = decoded.mimeType;
            sizeBytes = decoded.sizeBytes;
            sha256 = decoded.sha256;
            name = altName || decoded.suggestedName;
            st.byteStore.put(storageRef, decoded.bytes);
        } else {
            status = 'missing';
            failureReason = decoded.reason;
            dataUrlDiag = { code: decoded.code, message: decoded.message };
            // fileBase contains the base64 payload after 'image/<subType>'; avoid leaking it into name.
            if (!altName) name = 'image';
        }
    } else if (/^https?:\/\//i.test(trimmedSrc)) {
        status = 'remote';
        sourceUrl = trimmedSrc;
    } else if (/^blob:/i.test(trimmedSrc)) {
        status = 'missing';
        failureReason = 'blob: URL is not resolvable outside the originating page';
    } else {
        status = 'missing';
        failureReason = `inline image '${trimmedSrc.slice(0, 120)}' has no matching attachment or resolvable URL`;
    }
    st.inlineAssets.push({
        id: assetId,
        kind: 'image',
        name,
        ...(mimeType ? { mimeType } : {}),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        ...(sha256 ? { sha256 } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(storageRef ? { storageRef } : {}),
        status,
        ...(failureReason ? { failureReason } : {}),
        sourceRef: st.sourceRef,
    });
    indexAssetRef(st.assetIndex, trimmedSrc, assetId);
    if (status === 'missing' && !ambiguous) {
        if (dataUrlDiag) {
            st.diagnostics.push({
                id: `inline-image-dataurl:${assetId}`,
                severity: 'warning',
                code: dataUrlDiag.code,
                message: dataUrlDiag.message,
                sourceRef: st.sourceRef,
                details: { src: dataUrlPreview(trimmedSrc) } as JsonValue,
            });
        } else {
            st.diagnostics.push({
                id: `inline-image-missing:${assetId}`,
                severity: 'warning',
                code: 'INLINE_IMAGE_ASSET_MISSING',
                message: `inline image '${name}' has no resolvable asset; renderers fall back to alt text`,
                sourceRef: st.sourceRef,
                details: { src: trimmedSrc.slice(0, 200) } as JsonValue,
            });
        }
    }
    return makeImageInline(assetId, alt, title);
}

function makeImageInline(assetId: string, alt: string, title: string | undefined): ImageInline {
    const cleanAlt = alt.trim();
    return {
        type: 'image',
        assetId,
        ...(cleanAlt ? { alt: cleanAlt } : {}),
        ...(title ? { title } : {}),
    };
}

function scanBracket(s: string, i: number): { text: string; end: number } | undefined {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
        if (s[j] === '[') depth++;
        else if (s[j] === ']') {
            depth--;
            if (depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
        }
    }
    return undefined;
}

function scanParen(s: string, i: number): { text: string; end: number } | undefined {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')') {
            depth--;
            if (depth === 0) return { text: s.slice(i + 1, j), end: j + 1 };
        }
    }
    return undefined;
}

function parseLinkTarget(inner: string): { href: string; title?: string } {
    const t = inner.trim();
    const m = /^(\S+)\s+("(?:[^"]*)"|'(?:[^']*)'|\([^)]*\))$/.exec(t);
    if (m) return { href: m[1], title: m[2].slice(1, -1) };
    return { href: t };
}

function tryParseBareImage(
    s: string, i: number, st: MdParser,
): { node: ImageInline; end: number } | undefined {
    const label = scanBracket(s, i + 1);
    if (!label || s[label.end] !== '(') return undefined;
    const dest = scanParen(s, label.end);
    if (!dest) return undefined;
    const { href, title } = parseLinkTarget(dest.text);
    return { node: linkInlineImage(href, label.text, title, st), end: dest.end };
}

function tryParseLinkedImage(
    s: string, i: number, st: MdParser,
): { node: InlineNode; end: number } | undefined {
    const outer = scanBracket(s, i);
    if (!outer || s[outer.end] !== '(' || !outer.text.startsWith('![')) return undefined;
    const hrefParen = scanParen(s, outer.end);
    if (!hrefParen) return undefined;
    const img = tryParseBareImage(outer.text, 0, st);
    if (!img || img.end !== outer.text.length) return undefined;
    const { href, title: hrefTitle } = parseLinkTarget(hrefParen.text);
    return {
        node: { type: 'link', href, ...(hrefTitle ? { title: hrefTitle } : {}), children: [img.node] },
        end: hrefParen.end,
    };
}

function tryParseLink(s: string, i: number): { node: InlineNode; end: number } | undefined {
    const label = scanBracket(s, i);
    if (!label || s[label.end] !== '(') return undefined;
    const dest = scanParen(s, label.end);
    if (!dest) return undefined;
    const { href, title } = parseLinkTarget(dest.text);
    return {
        node: { type: 'link', href, ...(title ? { title } : {}), children: parseEmphasis(label.text) },
        end: dest.end,
    };
}

function parseInline(text: string, idPrefix: string, st: MdParser): InlineNode[] {
    // Mask code and math spans with NUL placeholders so their delimiters are ignored by link/emphasis scanners.
    const codeSpans: string[] = [];
    const mathSpans: string[] = [];
    let s = text.replace(/`([^`\n]+)`/g, (_m, code) => {
        codeSpans.push(code);
        return `\u0000C${codeSpans.length - 1}\u0000`;
    });
    s = s.replace(/\$\$([^$\n]+?)\$\$/g, (_m, formula) => {
        mathSpans.push(formula);
        return `\u0000M${mathSpans.length - 1}\u0000`;
    });
    s = s.replace(/(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g, (_m, formula) => {
        mathSpans.push(formula);
        return `\u0000M${mathSpans.length - 1}\u0000`;
    });

    const out: InlineNode[] = [];
    let buf = '';
    const flush = (): void => {
        if (buf) {
            for (const n of parseEmphasis(buf)) out.push(n);
            buf = '';
        }
    };
    let i = 0;
    while (i < s.length) {
        const ph = /^\u0000([CM])(\d+)\u0000/.exec(s.slice(i));
        if (ph) {
            flush();
            const idx = Number(ph[2]);
            if (ph[1] === 'C') out.push({ type: 'inlineCode', code: codeSpans[idx] ?? '' });
            else out.push({ type: 'inlineMath', source: mathSpans[idx] ?? '', notation: 'latex' });
            i += ph[0].length;
            continue;
        }
        if (s[i] === '!' && s[i + 1] === '[') {
            const bare = tryParseBareImage(s, i, st);
            if (bare) {
                flush();
                out.push(bare.node);
                i = bare.end;
                continue;
            }
        }
        if (s[i] === '[') {
            const linked = tryParseLinkedImage(s, i, st);
            if (linked) {
                flush();
                out.push(linked.node);
                i = linked.end;
                continue;
            }
            const link = tryParseLink(s, i);
            if (link) {
                flush();
                out.push(link.node);
                i = link.end;
                continue;
            }
        }
        buf += s[i];
        i++;
    }
    flush();
    return out;
}

function parseEmphasis(seg: string): InlineNode[] {
    if (!seg) return [];
    const markers = ['***', '___', '**', '__', '~~', '*', '_'] as const;
    const make = (m: string, children: InlineNode[]): InlineNode => {
        if (m === '***' || m === '___') {
            return { type: 'strong', children: [{ type: 'emphasis', children }] };
        }
        if (m === '**' || m === '__') return { type: 'strong', children };
        if (m === '~~') return { type: 'strikethrough', children };
        return { type: 'emphasis', children };
    };
    const out: InlineNode[] = [];
    let buf = '';
    const flush = (): void => {
        if (buf) {
            out.push({ type: 'text', text: buf });
            buf = '';
        }
    };
    const markerAt = (pos: number): string | undefined => {
        for (const m of markers) {
            if (seg.startsWith(m, pos)) return m;
        }
        return undefined;
    };
    let i = 0;
    while (i < seg.length) {
        const m = markerAt(i);
        if (!m) {
            buf += seg[i];
            i++;
            continue;
        }
        const ch = m[0];
        let j = seg.indexOf(m, i + m.length);
        let closer = -1;
        // Reject closers adjacent to the same marker char so '*a **b** c*' does not close at '**'.
        while (j >= 0) {
            if (seg[j - 1] !== ch && seg[j + m.length] !== ch) {
                closer = j;
                break;
            }
            j = seg.indexOf(m, j + 1);
        }
        if (closer < 0) {
            buf += m;
            i += m.length;
            continue;
        }
        flush();
        out.push(make(m, parseEmphasis(seg.slice(i + m.length, closer))));
        i = closer + m.length;
    }
    flush();
    return out;
}

function isTableSeparator(line: string): boolean {
    const t = line.trim();
    // Require at least one pipe so setext headings ('text\n---') are not misparsed as 1-column tables.
    if (!t.includes('|')) return false;
    let c = t.startsWith('|') ? t.slice(1) : t;
    c = c.endsWith('|') ? c.slice(0, -1) : c;
    const parts = c.split('|').map((p) => p.trim());
    return parts.length > 0 && parts.every((p) => /^:?-+:?$/.test(p));
}

function parseTableRow(line: string): string[] {
    const spans: string[] = [];
    let c = line.trim();
    c = c.replace(/\\\|/g, () => {
        spans.push('|');
        return `\u0000P${spans.length - 1}\u0000`;
    });
    c = c.replace(/`([^`\n]*)`/g, (_m, code) => {
        spans.push(`\`${code}\``);
        return `\u0000P${spans.length - 1}\u0000`;
    });
    if (c.startsWith('|')) c = c.slice(1);
    if (c.endsWith('|')) c = c.slice(0, -1);
    return c.split('|').map((x) => x.trim().replace(/\u0000P(\d+)\u0000/g, (_m, n) => spans[Number(n)] ?? ''));
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
    const buildAt = (start: number, levelIndent: number): { nodes: BlockNode[]; next: number } => {
        const nodes: BlockNode[] = [];
        let k = start;
        while (k < items.length && items[k].indent >= levelIndent) {
            if (items[k].indent > levelIndent) {
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
                    id: st.nextBlockId(),
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
                id: st.nextBlockId(),
                type: 'list',
                ordered,
                ...(ordered ? { start: startNum } : {}),
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
                id: st.nextBlockId(),
                type: 'code',
                code: codeLines.join('\n'),
                ...(langTok[0] ? { language: langTok[0] } : {}),
                ...(langTok.length > 1 ? { meta: langTok.slice(1).join(' ') } : {}),
            });
            continue;
        }

        if (trimmed.startsWith('$$')) {
            const selfClosed = trimmed.length > 4 && trimmed !== '$$' &&
                /\$\$[^$\n]+\$\$\s*$/.test(trimmed) &&
                trimmed.indexOf('$$', 2) === trimmed.length - 2;
            if (selfClosed) {
                const inner = trimmed.slice(2, -2).trim();
                blocks.push({ id: st.nextBlockId(), type: 'math', source: inner, notation: 'latex' });
                i++;
                continue;
            }
            if (trimmed === '$$') {
                const mathLines: string[] = [];
                let closed = false;
                i++;
                while (i < lines.length) {
                    const cur = lines[i].trim();
                    if (cur === '$$') { i++; closed = true; break; }
                    if (cur.endsWith('$$')) { mathLines.push(cur.replace(/\$\$$/, '').trim()); i++; closed = true; break; }
                    mathLines.push(lines[i]);
                    i++;
                }
                const mathBlockId = st.nextBlockId();
                if (!closed) {
                    st.diagnostics.push({
                        id: `math-fence-unclosed:${mathBlockId}`,
                        severity: 'warning',
                        code: 'MATH_FENCE_UNCLOSED',
                        message: 'display-math fence never closed; kept collected lines as the formula source',
                        sourceRef: st.sourceRef,
                        details: { line: trimmed.slice(0, 80) } as JsonValue,
                    });
                }
                const source = mathLines.join('\n').trim();
                if (!source) {
                    st.diagnostics.push({
                        id: `math-empty:${mathBlockId}`,
                        severity: 'warning',
                        code: 'MATH_BLOCK_EMPTY',
                        message: 'empty display-math fence; kept as source evidence',
                        sourceRef: st.sourceRef,
                        details: { line: trimmed.slice(0, 80) } as JsonValue,
                    });
                }
                blocks.push({ id: mathBlockId, type: 'math', source, notation: 'latex' });
                continue;
            }
            // Consume inline '$$...$$' with trailing text here because the paragraph collector below breaks on '$$'.
            blocks.push({
                id: st.nextBlockId(),
                type: 'paragraph',
                children: parseInline(line, idPrefix, st),
                sourceRef: st.sourceRef,
            });
            i++;
            continue;
        }

        if (i + 1 < lines.length && trimmed.includes('|') && isTableSeparator(lines[i + 1])) {
            const headerCells = parseTableRow(line);
            const aligns = tableAlignments(lines[i + 1]);
            i += 2;
            const bodyRows: string[][] = [];
            while (i < lines.length && lines[i].includes('|') && !isTableSeparator(lines[i])) {
                bodyRows.push(parseTableRow(lines[i]));
                i++;
            }
            const cell = (t: string): { children: InlineNode[] } => ({ children: parseInline(t, idPrefix, st) });
            blocks.push({
                id: st.nextBlockId(),
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
                id: st.nextBlockId(),
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
                id: st.nextBlockId(),
                type: 'quote',
                blocks: parseMarkdownBlocks(bqLines.join('\n'), idPrefix, st),
            });
            continue;
        }

        if (/^([-*_]){3,}$/.test(trimmed)) {
            blocks.push({ id: st.nextBlockId(), type: 'thematicBreak' });
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
                (ct.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) ||
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
            blocks.push({ id: st.nextBlockId(), type: 'paragraph', children });
        }
    }
    return blocks;
}

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

    const mimeType = a.mimeType || a.mime || undefined;
    const asset: Asset = {
        id,
        kind,
        name: attachmentDisplayName(a, isImage),
        ...(mimeType ? { mimeType } : {}),
        ...(typeof a.size === 'number' ? { sizeBytes: a.size } : {}),
        ...(typeof a.width === 'number' && typeof a.height === 'number'
            ? { dimensions: { widthPx: a.width, heightPx: a.height } }
            : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(storageRef ? { storageRef } : {}),
        status,
        ...(status === 'missing'
            ? { failureReason: 'no usable bytes, local file or URL in attachment record' }
            : {}),
        sourceRef,
        ...(a.type ? { extensions: { gemini: { attachmentType: String(a.type) } as JsonValue } } : {}),
    };
    const classified = classifyAssetAvailability(asset, hasInlineBytes || hasLocalFile);
    if (classified.diagnostic) diagnostics.push(classified.diagnostic);
    return { asset, diagnostics, isImage, origin };
}

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
                push(isStr(o.title) ? { url: o.url, title: o.title } : { url: o.url });
            } else skipped++;
        }
    }
    const fromSources = m.sources;
    if (Array.isArray(fromSources)) {
        for (const s of fromSources) {
            if (isStr(s)) push({ url: s });
            else if (s && typeof s === 'object' && isStr((s as { url?: unknown }).url)) {
                const o = s as { url: string; title?: unknown };
                push(isStr(o.title) ? { url: o.url, title: o.title } : { url: o.url });
            } else skipped++;
        }
    }
    return { list, skipped };
}

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
    ctx: { providerId: string; diag: Diagnostic[]; byteStore: InlineByteStore },
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
        ...(isStr(m.id) ? { providerMessageId: m.id } : {}),
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
    let blockSeq = 0;
    const nextBlockId = (): string => `${idPrefix}-b${blockSeq++}`;

    // Index attachments before markdown parsing so inline ![alt](src) nodes can link to their Asset IDs.
    const merged = mergeMessageAttachments(m);
    const attachmentBlocks: BlockNode[] = [];
    const assets: Asset[] = [];
    const assetIds: string[] = [];
    const assetIndex = newAssetLinkIndex();
    merged.forEach((a, ai) => {
        const assetId = `${msgId}-a${ai}`;
        const built = buildAsset(a, assetId, { ...sourceRef, locator: `${locator}.attachments[${ai}]` },
            a.isGenerated ? 'generated' : a.__origin === 'attachment' ? 'attachment' : a.__origin === 'image' ? 'inline' : 'unknown');
        assets.push(built.asset);
        assetIds.push(assetId);
        for (const ref of [a.localName, a.url, a.sourceUrl, a.resolvedUrl, a.src]) {
            if (typeof ref === 'string' && ref) {
                indexAssetRef(assetIndex, ref, assetId);
            }
        }
        diagnostics.push(...built.diagnostics);
        const bid = nextBlockId();
        if (built.isImage) {
            attachmentBlocks.push({
                id: bid, type: 'image', assetId,
                alt: built.asset.name, origin: built.origin,
                sourceRef,
            });
        } else {
            attachmentBlocks.push({
                id: bid, type: 'file', assetId,
                label: built.asset.name, origin: built.origin,
                sourceRef,
            });
        }
    });

    const st: MdParser = { diagnostics, sourceRef, assetIndex, inlineAssets: [], idPrefix, byteStore: ctx.byteStore, nextBlockId };
    const blocks: BlockNode[] = [];

    const thoughtsRaw = m.thoughts ?? m.thinking ?? '';
    const thoughtsText = cleanBody(Array.isArray(thoughtsRaw) ? thoughtsRaw.join('\n\n') : thoughtsRaw);
    if (thoughtsText.trim()) {
        blocks.push({
            id: nextBlockId(),
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
            id: nextBlockId(),
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

    for (const ia of st.inlineAssets) {
        assets.push(ia);
        assetIds.push(ia.id);
    }
    blocks.push(...attachmentBlocks);

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
            id: nextBlockId(),
            type: 'citationGroup',
            citationIds: citations.map((c) => c.id),
            sourceRef,
        } as BlockNode);
    }

    const unknownFields = Object.keys(m ?? {}).filter((k) => !KNOWN_MESSAGE_FIELDS.has(k));
    const createdAt = toIso(m.timestamp);
    const node: MessageNode = {
        id: msgId,
        role,
        ...(rawRole ? { author: { rawRole } } : {}),
        ...(createdAt ? { createdAt } : {}),
        blocks,
        ...(assetIds.length ? { associatedAssetIds: assetIds } : {}),
        sourceRef,
        ...(unknownFields.length
            ? { extensions: { gemini: { unknownFields } as JsonValue } }
            : {}),
    };
    return { node, assets, citations, diagnostics };
}

function normalizeTitle(raw: RepoConversation, diagnostics: Diagnostic[]): ConversationTitle | undefined {
    const candidates: TitleCandidate[] = [];
    const titles = raw.titles;
    if (titles && typeof titles === 'object') {
        for (const [src, val] of Object.entries(titles)) {
            if (isStr(val) && val.trim()) {
                candidates.push({ value: val.trim(), source: canonicalTitleSource(src, diagnostics) });
            }
        }
    }
    if (isStr(raw.title) && raw.title.trim()) {
        const source = canonicalTitleSource(raw.titleSource, diagnostics);
        if (!candidates.some((c) => c.value === raw.title.trim() && c.source === source)) {
            candidates.push({ value: raw.title.trim(), source });
        }
    }
    if (!candidates.length) return undefined;
    return resolveTitle(candidates);
}

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
): Promise<GeminiNormalizationResult> {
    const providerId = options.providerId ?? 'gemini';
    const accountId = options.accountId ?? '';
    const observedAt = options.observedAt ?? new Date().toISOString();
    const diagnostics: Diagnostic[] = [];
    const assets: Asset[] = [];
    const citations: Citation[] = [];
    const byteStore = createInlineByteStore();

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
        const built = normalizeMessage(m, index, locator, { providerId, diag: diagnostics, byteStore });
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
        ...(unknownFields.length ? { unknownFields } : {}),
        ...(options.rawRef ? { rawRef: options.rawRef } : {}),
        extensions: {
            gemini: {
                source: isStr(raw.source) ? raw.source : null,
                accountSlot: isStr(raw.accountSlot) ? raw.accountSlot : null,
                isTakeoutOnly: raw.isTakeoutOnly ?? null,
                titleSource: isStr(raw.titleSource) ? raw.titleSource : null,
            } as JsonValue,
        },
    };

    const convCreatedAt = toIso(raw.createdAt ?? raw.timestamp ?? raw.chatTime);
    const convUpdatedAt = toIso(raw.updatedAt ?? raw.lastSeen);
    const bundle: CanonicalConversationBundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId, accountId, conversationId: isStr(raw.id) ? raw.id : '' },
            ...(title ? { title } : {}),
            ...(convCreatedAt ? { createdAt: convCreatedAt } : {}),
            ...(convUpdatedAt ? { updatedAt: convUpdatedAt } : {}),
            observedAt,
            messages,
            ...(raw.url || raw.href
                ? { extensions: { gemini: { url: (raw.url || raw.href) as string } as JsonValue } }
                : {}),
        },
        assets,
        citations,
        observations: [observation],
        ...(diagnostics.length ? { diagnostics } : {}),
    };

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

    return { bundle, diagnostics, byteStore };
}

export class GeminiNormalizer implements ProviderNormalizer<RepoConversation> {
    readonly providerId = 'gemini';
    private readonly options: GeminiNormalizationOptions;

    constructor(options: GeminiNormalizationOptions = {}) {
        this.options = options;
    }

    async normalize(raw: RepoConversation, context: NormalizationContext): Promise<NormalizationResult> {
        let rawRef = this.options.rawRef;
        let rawEvidenceError: string | undefined;
        const effectiveProviderId = context.providerId || this.options.providerId || this.providerId;
        if (context.rawEvidence && !rawRef) {
            try {
                rawRef = await context.rawEvidence.put('gemini-conversation', raw);
            } catch (err) {
                rawRef = this.options.rawRef;
                rawEvidenceError = err instanceof Error ? err.message : String(err);
            }
        }
        const result = await normalizeGeminiConversation(raw, {
            ...this.options,
            rawRef,
            providerId: effectiveProviderId,
            accountId: context.accountId,
            observedAt: context.observedAt,
        });
        if (rawEvidenceError !== undefined) {
            const diagnostic: Diagnostic = {
                id: 'raw-evidence:write-failed',
                severity: 'warning',
                code: 'RAW_EVIDENCE_WRITE_FAILED',
                message: 'raw evidence persistence failed; continuing without an archived raw payload',
                sourceRef: { providerId: effectiveProviderId },
                details: { error: rawEvidenceError.slice(0, 300) } as JsonValue,
            };
            result.diagnostics.push(diagnostic);
            if (!result.bundle.diagnostics) {
                result.bundle.diagnostics = result.diagnostics;
            } else if (result.bundle.diagnostics !== result.diagnostics) {
                result.bundle.diagnostics.push(diagnostic);
            }
        }
        return result;
    }
}
