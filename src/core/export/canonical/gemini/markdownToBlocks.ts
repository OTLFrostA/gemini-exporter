import { convertHtmlToMarkdown } from '../../../engine/formatters/htmlConverter.js';
import { stripInternalChipMarkdown } from '../../../utils/chipUtils.js';
import type { BlockNode } from '../blocks.js';
import type { ImageInline, InlineNode } from '../inline.js';
import type { JsonValue } from '../json.js';
import {
    type AssetParserContext,
    linkInlineImage,
} from './normalizeAssets.js';

export interface MdParser extends AssetParserContext {
    nextBlockId: () => string;
}

export function cleanBody(text: unknown): string {
    if (typeof text !== 'string' || !text) return '';
    return stripInternalChipMarkdown(convertHtmlToMarkdown(text));
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
        node: { type: 'link', href, ...(title ? { title: href } : {}), children: parseEmphasis(label.text) },
        end: dest.end,
    };
}

export function parseInline(text: string, idPrefix: string, st: MdParser): InlineNode[] {
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

/**
 * CommonMark-style delimiter boundary helpers for underscore emphasis.
 * `undefined` (string start/end) counts as whitespace and not punctuation,
 * matching CommonMark's "beginning/end of line" boundary treatment.
 */
function isWhitespace(ch: string | undefined): boolean {
    return ch === undefined || /\s/.test(ch);
}

function isPunctuation(ch: string | undefined): boolean {
    return ch !== undefined && /[\p{P}\p{S}]/u.test(ch);
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
    // Underscore delimiters (`_`, `__`, `___`) may only open/close emphasis
    // when CommonMark left/right-flanking rules allow it. This keeps
    // intra-word underscores (foo_bar, T_N, \sum_{...}, file names) as plain
    // text without any LaTeX-specific special-casing.
    // Regression: do not restore the old "any next same marker pairs" scan.
    const flanking = (pos: number, len: number): { left: boolean; right: boolean } => {
        const prev = pos > 0 ? seg[pos - 1] : undefined;
        const next = pos + len < seg.length ? seg[pos + len] : undefined;
        const leftFlanking =
            !isWhitespace(next) && (!isPunctuation(next) || isWhitespace(prev) || isPunctuation(prev));
        const rightFlanking =
            !isWhitespace(prev) && (!isPunctuation(prev) || isWhitespace(next) || isPunctuation(next));
        return { left: leftFlanking, right: rightFlanking };
    };
    const canOpenUnderscore = (pos: number, len: number): boolean => {
        const { left, right } = flanking(pos, len);
        const prev = pos > 0 ? seg[pos - 1] : undefined;
        return left && (!right || isPunctuation(prev));
    };
    const canCloseUnderscore = (pos: number, len: number): boolean => {
        const { left, right } = flanking(pos, len);
        const next = pos + len < seg.length ? seg[pos + len] : undefined;
        return right && (!left || isPunctuation(next));
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
        const isUnderscore = ch === '_';
        if (isUnderscore && !canOpenUnderscore(i, m.length)) {
            buf += m;
            i += m.length;
            continue;
        }
        let j = seg.indexOf(m, i + m.length);
        let closer = -1;
        // Reject closers adjacent to the same marker char so '*a **b** c*' does not close at '**'.
        // Underscore candidates must additionally satisfy the closer boundary rule.
        while (j >= 0) {
            if (
                seg[j - 1] !== ch &&
                seg[j + m.length] !== ch &&
                (!isUnderscore || canCloseUnderscore(j, m.length))
            ) {
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

export function parseMarkdownBlocks(markdown: string, idPrefix: string, st: MdParser): BlockNode[] {
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
