import type { BlockNode, TableRow } from '../../../domain/content/blocks.js';
import type { InlineNode } from '../../../domain/content/inline.js';

/** Read the authored DOM tree once; nested pre/code and list text are never collected twice. */
export function parseDomContent(root: Element): BlockNode[] {
    const children = (node: Node): Node[] => Array.from(node.childNodes ?? []);
    const element = (node: Node): node is Element => node.nodeType === 1;
    const tag = (node: Element): string => node.tagName.toLowerCase();
    const ignored = (node: Element): boolean => ['script', 'style', 'button'].includes(tag(node)) || node.getAttribute('aria-hidden') === 'true';
    const tex = (node: Element): string | undefined => node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? undefined;
    const inlines = (nodes: Node[]): InlineNode[] => nodes.flatMap(node => {
        if (!element(node)) return node.nodeType === 3 && node.textContent ? [{ type: 'text' as const, text: node.textContent }] : [];
        if (ignored(node)) return [];
        const source = tex(node);
        if (source && (node.classList?.contains('katex') || node.classList?.contains('katex-display'))) return [{ type: 'inlineMath' as const, source }];
        const nested = (): InlineNode[] => inlines(children(node));
        switch (tag(node)) {
            case 'br': return [{ type: 'lineBreak' as const, kind: 'hard' as const }];
            case 'strong': case 'b': return [{ type: 'strong' as const, children: nested() }];
            case 'em': case 'i': return [{ type: 'emphasis' as const, children: nested() }];
            case 'del': case 's': return [{ type: 'strikethrough' as const, children: nested() }];
            case 'code': return [{ type: 'inlineCode' as const, code: node.textContent ?? '' }];
            case 'a': { const href = node.getAttribute('href'); return href ? [{ type: 'link' as const, href, children: nested() }] : nested(); }
            case 'img': { const uri = node.getAttribute('src') || (node as HTMLImageElement).src; return uri ? [{ type: 'image' as const, assetId: uri, ...(node.getAttribute('alt') ? { alt: node.getAttribute('alt')! } : {}) }] : []; }
            default: return nested();
        }
    });
    const blocks = (nodes: Node[]): BlockNode[] => {
        const output: BlockNode[] = [];
        let pending: Node[] = [];
        const flush = (): void => { const content = inlines(pending); pending = []; if (content.some(node => node.type !== 'text' || node.text.trim())) output.push({ type: 'paragraph', children: content }); };
        for (const node of nodes) {
            if (!element(node)) { pending.push(node); continue; }
            if (ignored(node)) continue;
            const name = tag(node);
            const source = tex(node);
            if (source && node.classList?.contains('katex-display')) { flush(); output.push({ type: 'math', source }); continue; }
            if (/^h[1-6]$/.test(name)) { flush(); output.push({ type: 'heading', level: Number(name[1]) as 1 | 2 | 3 | 4 | 5 | 6, children: inlines(children(node)) }); }
            else if (name === 'pre') { flush(); const code = node.querySelector('code') ?? node; const language = /(?:^|\s)language-([\w+-]+)/.exec(code.getAttribute('class') ?? '')?.[1]; output.push({ type: 'code', code: code.textContent ?? '', ...(language ? { language } : {}) }); }
            else if (name === 'ul' || name === 'ol') { flush(); const start = Number(node.getAttribute('start')); output.push({ type: 'list', ordered: name === 'ol', ...(name === 'ol' && Number.isInteger(start) && start > 0 ? { start } : {}), items: Array.from(node.children).filter(child => tag(child) === 'li').map(item => ({ blocks: blocks(children(item)) })) }); }
            else if (name === 'blockquote') { flush(); output.push({ type: 'quote', blocks: blocks(children(node)) }); }
            else if (name === 'table') {
                flush();
                const headerRows: TableRow[] = [], rows: TableRow[] = [];
                for (const row of Array.from(node.querySelectorAll('tr'))) {
                    if (typeof row.closest === 'function' && row.closest('table') !== node) continue;
                    const cells = Array.from(row.children).filter(cell => tag(cell) === 'td' || tag(cell) === 'th');
                    const mapped = { cells: cells.map(cell => { const colSpan = Number(cell.getAttribute('colspan')), rowSpan = Number(cell.getAttribute('rowspan')); return { children: inlines(children(cell)), ...(Number.isInteger(colSpan) && colSpan > 1 ? { colSpan } : {}), ...(Number.isInteger(rowSpan) && rowSpan > 1 ? { rowSpan } : {}) }; }) };
                    if (cells.length && (row.closest?.('thead') || cells.every(cell => tag(cell) === 'th'))) headerRows.push(mapped); else if (cells.length) rows.push(mapped);
                }
                const caption = node.querySelector('caption');
                output.push({ type: 'table', ...(caption ? { caption: inlines(children(caption)) } : {}), ...(headerRows.length ? { headerRows } : {}), rows });
            }
            else if (name === 'hr') { flush(); output.push({ type: 'thematicBreak' }); }
            else if (['p', 'div', 'section', 'article', 'figure', 'figcaption', 'details', 'summary', 'li'].includes(name)) { flush(); output.push(...blocks(children(node))); }
            else pending.push(node);
        }
        flush(); return output;
    };
    return blocks(children(root));
}
