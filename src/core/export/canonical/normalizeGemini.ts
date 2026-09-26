/**
 * src/core/export/canonical/normalizeGemini.ts
 * F2b: Gemini provider normalizer — repo Conversation -> CanonicalConversationBundle.
 *
 * Implements ProviderNormalizer<Conversation> (see normalizer.ts). Markdown body
 * parsing follows a canonical-first policy (see the markdown section below):
 * it answers "what semantic content did the provider give us?" and is NOT
 * limited to the subset renderMarkdownToHtml() recognizes
 * (src/core/engine/template/htmlTemplate.ts). Bodies are still cleaned with the
 * same convertHtmlToMarkdown + stripInternalChipMarkdown pass the HTML
 * exporter uses.
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
import { decodeDataUrlAsset, putInlineAssetBytes } from '../assets/index.js';
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
//
// Canonical-first markdown policy: this parser answers "what semantic content
// did the provider give us?", never "what subset can a renderer display". It
// is intentionally decoupled from the legacy HTML renderer's supported subset
// (src/core/engine/template/htmlTemplate.ts): renderer limitations must not
// become permanent information-loss rules in canonical data. Where a syntax
// feature is genuinely unsupported, the source evidence is preserved and an
// explicit diagnostic is emitted -- content is never silently reinterpreted
// to match legacy renderer behavior.

interface MdParser {
    /** Message-level diagnostics; markdown parsing appends here directly. */
    diagnostics: Diagnostic[];
    /** sourceRef stamped on parser-created assets and diagnostics. */
    sourceRef: SourceRef;
    /** Normalized attachment reference -> asset id, for inline image linking. */
    assetIndex: Map<string, string>;
    /** Assets created for inline markdown images; merged into the bundle by the caller. */
    inlineAssets: Asset[];
    /** Message id prefix used for generated asset ids. */
    idPrefix: string;
}

let blockSeq = 0;
const nextBlockId = (prefix: string): string => `${prefix}-b${blockSeq++}`;

/** Normalizable match keys for linking an inline image src to an attachment asset. */
function assetMatchKeys(ref: string): string[] {
    const keys = [ref];
    const noPrefix = ref.replace(/^assets\//, '');
    if (noPrefix !== ref) keys.push(noPrefix);
    const base = noPrefix.split('/').pop() ?? '';
    if (base && base !== noPrefix) keys.push(base);
    try {
        const decoded = decodeURIComponent(noPrefix);
        if (decoded !== noPrefix) keys.push(decoded);
    } catch {
        // Not percent-encoded; nothing to add.
    }
    return keys;
}

/**
 * Build the first-class inline image node for a known `![alt](src)`. The image
 * links through the canonical asset table: an attachment with a matching
 * reference is reused, otherwise a new asset records the honest availability
 * (remote URL -> 'remote', embedded data: URL -> decoded to a byte-backed
 * 'available' asset, anything else -> 'missing' + warning). Known images are
 * never unknownInline.
 */
/** Short, payload-free preview of a data: URL for diagnostics. */
function dataUrlPreview(url: string): string {
    const head = url.slice(0, 64);
    return url.length > 64 ? `${head}…(${url.length} chars total)` : head;
}

function linkInlineImage(src: string, alt: string, title: string | undefined, st: MdParser): ImageInline {
    const trimmedSrc = src.trim();
    for (const key of assetMatchKeys(trimmedSrc)) {
        const hit = st.assetIndex.get(key);
        if (hit) {
            const cleanAlt = alt.trim();
            return {
                type: 'image',
                assetId: hit,
                ...(cleanAlt ? { alt: cleanAlt } : {}),
                ...(title ? { title } : {}),
            };
        }
    }
    const assetId = `${st.idPrefix}-img${st.inlineAssets.length}`;
    const base = (trimmedSrc.split('/').pop() ?? '').split('?')[0];
    const altName = alt.trim();
    let name = altName || base || 'image';
    let status: AssetStatus;
    let sourceUrl: string | undefined;
    let storageRef: string | undefined;
    let mimeType: string | undefined;
    let sizeBytes: number | undefined;
    let sha256: string | undefined;
    let failureReason: string | undefined;
    // Set when a data: URL is refused or fails to decode; the generic
    // INLINE_IMAGE_ASSET_MISSING diagnostic below is skipped in that case.
    let dataUrlDiag: { code: 'DATA_URL_TOO_LARGE' | 'DATA_URL_MALFORMED'; message: string } | undefined;
    if (/^data:/i.test(trimmedSrc)) {
        // Scheme B: decode the data: URL into real bytes at normalize time.
        // The asset becomes byte-backed ('available' with a content-addressed
        // storageRef and bytes in the inline byte store), never
        // pseudo-available. sourceUrl is deliberately omitted -- embedding the
        // full data: URL would explode the serialized bundle; the bytes are
        // the source of truth.
        const decoded = decodeDataUrlAsset(trimmedSrc);
        if (decoded.ok) {
            status = 'available';
            storageRef = decoded.storageRef;
            mimeType = decoded.mimeType;
            sizeBytes = decoded.sizeBytes;
            sha256 = decoded.sha256;
            name = altName || decoded.suggestedName;
            putInlineAssetBytes(storageRef, decoded.bytes);
        } else {
            status = 'missing';
            failureReason = decoded.reason;
            dataUrlDiag = { code: decoded.code, message: decoded.message };
            // Never leak a payload tail into the asset name.
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
    for (const key of assetMatchKeys(trimmedSrc)) st.assetIndex.set(key, assetId);
    if (status === 'missing') {
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
    const cleanAlt = alt.trim();
    return {
        type: 'image',
        assetId,
        ...(cleanAlt ? { alt: cleanAlt } : {}),
        ...(title ? { title } : {}),
    };
}

/** Scan s from i (s[i] === '[') for the matching ']' with bracket nesting. */
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

/** Scan s from i (s[i] === '(') for the matching ')' with paren nesting. */
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

/** Split a link/image destination into URL and an optional quoted title. */
function parseLinkTarget(inner: string): { href: string; title?: string } {
    const t = inner.trim();
    const m = /^(\S+)\s+("(?:[^"]*)"|'(?:[^']*)'|\([^)]*\))$/.exec(t);
    if (m) return { href: m[1], title: m[2].slice(1, -1) };
    return { href: t };
}

/** Try `![alt](src)` at s[i] (s[i] === '!', s[i+1] === '['). */
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

/**
 * Try `[![alt](src)](href)` at s[i]. A bare `[!text](href)` (no image inside)
 * is not a linked image and is left for literal/link handling.
 */
function tryParseLinkedImage(
    s: string, i: number, st: MdParser,
): { node: InlineNode; end: number } | undefined {
    // s[i] === '[' opens the link; the image (if any) starts at i + 1.
    // Scan from i so the nested image brackets balance correctly.
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

/** Try `[label](dest)` at s[i] (s[i] === '['). */
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
    // Protect code spans first so delimiters inside `code` are never
    // reinterpreted; then math spans (display `$$..$$` pairs, then `$..$`).
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
            // A linked image `[![alt](src)](href)` opens with '[' too, so try
            // it before a plain link.
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
    // Recursive-descent scanner: at each position take the longest marker
    // ('***' > '**' > '*', '___' > '__' > '_', plus '~~'), then pair it with
    // the next "clean" occurrence of the same marker — one that is not part
    // of a longer run of the same char, so '*a **b** c*' nests correctly
    // instead of closing at the first '*' of '**'. Unmatched markers stay
    // literal text (malformed input is preserved, not dropped).
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
    // A delimiter row needs at least one pipe: this keeps a bare `text\n---`
    // as a setext heading, never a one-column table. Edge pipes are optional
    // (borderless tables are valid markdown).
    if (!t.includes('|')) return false;
    let c = t.startsWith('|') ? t.slice(1) : t;
    c = c.endsWith('|') ? c.slice(0, -1) : c;
    const parts = c.split('|').map((p) => p.trim());
    return parts.length > 0 && parts.every((p) => /^:?-+:?$/.test(p));
}

function parseTableRow(line: string): string[] {
    // Protect escaped pipes and code spans so a `|` inside `code` (or `\|`)
    // is not mistaken for a column separator; edge pipes are optional.
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
                id: nextBlockId(idPrefix),
                type: 'code',
                code: codeLines.join('\n'),
                ...(langTok[0] ? { language: langTok[0] } : {}),
                ...(langTok.length > 1 ? { meta: langTok.slice(1).join(' ') } : {}),
            });
            continue;
        }

        if (trimmed.startsWith('$$')) {
            // A display-math BLOCK only when the whole line is `$$...$$` with
            // nothing but whitespace after the closing delimiter. A same-line
            // formula with trailing text (or several formulas on one line) is
            // inline math: hand the line to the paragraph parser so the
            // formula AND the text are preserved (never an empty MathBlock).
            const selfClosed = trimmed.length > 4 && trimmed !== '$$' &&
                /\$\$[^$\n]+\$\$\s*$/.test(trimmed) &&
                trimmed.indexOf('$$', 2) === trimmed.length - 2;
            if (selfClosed) {
                const inner = trimmed.slice(2, -2).trim();
                blocks.push({ id: nextBlockId(idPrefix), type: 'math', source: inner, notation: 'latex' });
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
                if (!closed) {
                    st.diagnostics.push({
                        id: `math-fence-unclosed:${idPrefix}-b${blockSeq}`,
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
                        id: `math-empty:${idPrefix}-b${blockSeq}`,
                        severity: 'warning',
                        code: 'MATH_BLOCK_EMPTY',
                        message: 'empty display-math fence; kept as source evidence',
                        sourceRef: st.sourceRef,
                        details: { line: trimmed.slice(0, 80) } as JsonValue,
                    });
                }
                blocks.push({ id: nextBlockId(idPrefix), type: 'math', source, notation: 'latex' });
                continue;
            }
            // Starts with '$$' but is neither self-closed nor a lone fence:
            // let the inline scanner split it into InlineMath + text. Consume
            // the line here (not via the paragraph collector below, whose
            // '$$' break condition would refuse it and loop forever).
            blocks.push({
                id: nextBlockId(idPrefix),
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

    // Contract: optional asset fields are omitted when absent, never emitted
    // as explicit `undefined` (which has no JSON representation and would make
    // the live bundle disagree with its serialized form).
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

    // Build attachment assets BEFORE parsing markdown so inline images can
    // link to them through the canonical asset table. The message-level
    // `attachments` array carries generated/pasted files; the bare markdown
    // image syntax `![alt](src)` (and `[![alt](src)](href)`) becomes a
    // first-class ImageInline node that references an Asset by id -- it is
    // never demoted to unknownInline.
    const merged = mergeMessageAttachments(m);
    const attachmentBlocks: BlockNode[] = [];
    const assets: Asset[] = [];
    const assetIds: string[] = [];
    const assetIndex = new Map<string, string>();
    merged.forEach((a, ai) => {
        const assetId = `${msgId}-a${ai}`;
        const built = buildAsset(a, assetId, { ...sourceRef, locator: `${locator}.attachments[${ai}]` },
            a.isGenerated ? 'generated' : a.__origin === 'attachment' ? 'attachment' : a.__origin === 'image' ? 'inline' : 'unknown');
        assets.push(built.asset);
        assetIds.push(assetId);
        for (const ref of [a.localName, a.url, a.sourceUrl, a.resolvedUrl, a.src]) {
            if (typeof ref === 'string' && ref) {
                for (const key of assetMatchKeys(ref)) assetIndex.set(key, assetId);
            }
        }
        diagnostics.push(...built.diagnostics);
        const bid = nextBlockId(idPrefix);
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

    const st: MdParser = { diagnostics, sourceRef, assetIndex, inlineAssets: [], idPrefix };
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

    // Assets created for inline markdown images join the bundle's asset table.
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
            id: nextBlockId(idPrefix),
            type: 'citationGroup',
            citationIds: citations.map((c) => c.id),
            sourceRef,
        } as BlockNode);
    }

    const unknownFields = Object.keys(m ?? {}).filter((k) => !KNOWN_MESSAGE_FIELDS.has(k));
    const createdAt = toIso(m.timestamp);
    // Contract: optional message fields are omitted when absent, never emitted
    // as explicit `undefined`.
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
        let rawEvidenceError: string | undefined;
        const effectiveProviderId = context.providerId || this.options.providerId || this.providerId;
        if (context.rawEvidence && !rawRef) {
            try {
                rawRef = await context.rawEvidence.put('gemini-conversation', raw);
            } catch (err) {
                // P2-5: a raw-evidence persistence failure must be visible, never
                // silently swallowed. Normalization continues (policy), but the
                // diagnostic below makes it explicit that no raw payload was archived.
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
            // rawRef was never persisted: do not let the observation imply it was.
            if (!result.bundle.diagnostics) {
                result.bundle.diagnostics = result.diagnostics;
            } else if (result.bundle.diagnostics !== result.diagnostics) {
                result.bundle.diagnostics.push(diagnostic);
            }
        }
        return result;
    }
}
