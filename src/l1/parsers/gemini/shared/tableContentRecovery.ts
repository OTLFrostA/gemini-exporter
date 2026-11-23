import type { BlockNode, TableBlock, TableCell } from '../../../../l2/content/blocks.js';
import type { InlineNode } from '../../../../l2/content/inline.js';

// The capture contains a pipe between two individually marked parenthesis
// formulas in one header cell, and its body rows are short by one cell.
function joinedParentheses(cell: TableCell): boolean {
    const [left, separator, right] = cell.children;
    return cell.children.length === 3
        && left.type === 'inlineMath' && left.source === '('
        && separator.type === 'text' && separator.text === '\\vert{}'
        && right.type === 'inlineMath' && right.source === ')';
}

const superscript = /(?<=[\p{L}\p{N}])\$(\^\d+)\$(?!\$)/gu;

export function hasRecoverableTableContent(block: BlockNode): block is TableBlock {
    if (block.type !== 'table') return false;
    const headers = block.headerRows ?? [];
    return headers.some(row => row.cells.some(joinedParentheses))
        || [...headers, ...block.rows].some(row => row.cells.some(cell =>
            cell.children.some(node => node.type === 'text' && !node.text.matchAll(superscript).next().done)));
}

function rectangularWidth(table: TableBlock): number | undefined {
    const header = table.headerRows?.[0]?.cells;
    if (table.headerRows?.length !== 1 || !header?.length || !table.rows.length || table.caption?.length) return undefined;
    if ([header, ...table.rows.map(row => row.cells)].some(cells => cells.length !== header.length
        || cells.some(cell => (cell.colSpan ?? 1) !== 1 || (cell.rowSpan ?? 1) !== 1))) return undefined;
    return header.length;
}

const same = (a: readonly InlineNode[], b: readonly InlineNode[]): boolean => JSON.stringify(a) === JSON.stringify(b);

function restoreSuperscript(children: InlineNode[]): InlineNode[] {
    return children.flatMap(node => {
        if (node.type !== 'text') return [node];
        const parts: InlineNode[] = [];
        let offset = 0;
        for (const match of node.text.matchAll(superscript)) {
            if (match.index > offset) parts.push({ type: 'text', text: node.text.slice(offset, match.index) });
            parts.push({ type: 'inlineMath', source: match[1] });
            offset = match.index + match[0].length;
        }
        if (!parts.length) return [node];
        if (offset < node.text.length) parts.push({ type: 'text', text: node.text.slice(offset) });
        return parts;
    });
}

function verifiedRepair(native: TableBlock, markdown: TableBlock): TableBlock | null {
    const width = rectangularWidth(native);
    const candidateWidth = rectangularWidth(markdown);
    if (!width || !candidateWidth || native.rows.length !== markdown.rows.length) return null;
    const header = native.headerRows?.[0]?.cells ?? [];
    const candidateHeader = markdown.headerRows?.[0]?.cells ?? [];

    if (candidateWidth === width + 1) {
        const joined = header.filter(joinedParentheses);
        if (joined.length !== 1) return null;
        const [left, , right] = joined[0].children;
        const comparisonHeader = header.flatMap(cell => cell === joined[0] ? [[left], [right]] : [cell.children]);
        if (!comparisonHeader.every((children, index) => same(children, candidateHeader[index].children))) return null;
        // Every surviving body cell must agree at its original coordinate.
        // Admit only the captured missing tail shape: empty or one inline formula.
        const tail = markdown.rows.map(row => row.cells[width]);
        if (!native.rows.every((row, i) => row.cells.every((cell, j) => same(cell.children, markdown.rows[i].cells[j].children)))
            || !tail.some(cell => cell.children.length)
            || tail.some(cell => cell.children.length > 1 || cell.children.some(node => node.type !== 'inlineMath'))) return null;
        // The split identifies the corresponding Markdown columns. Keep the
        // native cell, including its separator, across both output columns.
        return { ...native, headerRows: [{ cells: header.map(cell => cell === joined[0] ? { ...cell, colSpan: 2 } : cell) }],
            rows: native.rows.map((row, i) => ({ cells: [...row.cells, tail[i]] })) };
    }

    if (candidateWidth !== width) return null;
    let changed = false;
    const candidateRows = [candidateHeader, ...markdown.rows.map(row => row.cells)];
    const restoredRows: TableBlock['rows'] = [];
    const nativeRows = [header, ...native.rows.map(row => row.cells)];
    for (const [i, cells] of nativeRows.entries()) {
        const restored: TableCell[] = [];
        for (const [j, cell] of cells.entries()) {
            const other = candidateRows[i][j].children;
            if (same(cell.children, other)) {
                restored.push(cell);
                continue;
            }
            const children = restoreSuperscript(cell.children);
            if (!same(children, other)) return null;
            changed = true;
            restored.push({ ...cell, children });
        }
        restoredRows.push({ cells: restored });
    }
    const [restoredHeader, ...rows] = restoredRows;
    return changed ? { ...native, headerRows: [restoredHeader], rows } : null;
}

/** Restore only verified missing cells or inline math from the same candidate. */
export function recoverTableContent(blocks: BlockNode[], markdown: BlockNode[]): number {
    const nativeTables = blocks.filter(block => block.type === 'table');
    const markdownTables = markdown.filter(block => block.type === 'table');
    const candidates = nativeTables.filter(hasRecoverableTableContent).map(native => ({
        native,
        matches: markdownTables.flatMap(source => {
            const restored = verifiedRepair(native, source);
            return restored ? [{ source, restored }] : [];
        }),
    }));
    let recovered = 0;
    for (const { native, matches } of candidates) {
        const [match] = matches;
        if (matches.length !== 1) continue;
        const alsoMatches = candidates.some(other => other.native !== native && other.matches.some(candidate => candidate.source === match.source));
        const alreadyPresent = nativeTables.some(other => other !== native
            && JSON.stringify([other.headerRows, other.rows]) === JSON.stringify([match.restored.headerRows, match.restored.rows]));
        if (alsoMatches || alreadyPresent) continue;
        native.headerRows = match.restored.headerRows;
        native.rows = match.restored.rows;
        recovered++;
    }
    return recovered;
}
