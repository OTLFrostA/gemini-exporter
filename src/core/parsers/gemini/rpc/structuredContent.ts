import { GEMINI_JSPB_SCHEMA } from "./extractors.js";
import { extractImageEvidence } from "./sourceAttachments.js";

export interface GeminiAnnotation {
    start: number;
    end: number;
    type: number | 'source';
    sourceIds?: string[];
    url?: string;
}

export interface GeminiTextNode {
    nodeType: 18;
    text: string;
    jJ?: number; // heading level 1..6, or 0/undefined for paragraph
    annotations?: GeminiAnnotation[];
}

export interface GeminiMathBlockNode {
    nodeType: 12;
    FTa: string;
}

export interface GeminiCodeBlockNode {
    nodeType: 1;
    code: string;
    info?: string;
}

export interface GeminiThematicBreakNode {
    nodeType: 19;
}

export interface GeminiLineBreakNode {
    nodeType: 13;
}

export interface GeminiTableCell {
    children: GeminiStructuredNode[];
    colSpan?: number;
    rowSpan?: number;
}

export interface GeminiTableRow {
    cells: GeminiTableCell[];
}

export interface GeminiTableNode {
    nodeType: 17;
    rows: GeminiTableRow[];
}

export interface GeminiListItem {
    children: GeminiStructuredNode[];
}

export interface GeminiUnorderedListNode {
    nodeType: 20;
    items: GeminiListItem[];
}

export interface GeminiOrderedListNode {
    nodeType: 14;
    items: GeminiListItem[];
    VHa?: number; // 1-based start number
}

export interface GeminiQuoteNode {
    nodeType: 15;
    children: GeminiStructuredNode[];
}

export interface GeminiAttachmentNode {
    nodeType: 0;
    Xj?: Array<{
        attachmentType?: number;
        [key: string]: unknown;
    }>;
}

export interface GeminiFileNode { nodeType: 24; id: string; title: string }

/** Inline fragments share one paragraph; wire field 13 is not a line break. */
export interface GeminiCompositeParagraph { nodeType: 'paragraph'; children: GeminiStructuredNode[] }
export interface GeminiFileCitation { nodeType: 'citation'; number: number; title: string }
export interface GeminiCitationGroup { nodeType: 'citationGroup'; children: GeminiFileCitation[] }

export type GeminiStructuredNode =
    | GeminiCompositeParagraph
    | GeminiFileCitation
    | GeminiCitationGroup
    | GeminiTextNode
    | GeminiMathBlockNode
    | GeminiCodeBlockNode
    | GeminiThematicBreakNode
    | GeminiLineBreakNode
    | GeminiTableNode
    | GeminiUnorderedListNode
    | GeminiOrderedListNode
    | GeminiQuoteNode
    | GeminiAttachmentNode
    | GeminiFileNode;

export interface GeminiStructuredDocument {
    children: GeminiStructuredNode[];
}

/** Shape-only rejection evidence: never includes source text, URLs or file tokens. */
export interface GeminiStructuredDecodeIssue {
    kind: 'annotation' | 'node' | 'payload';
    nodeType?: number;
    fields?: number[];
    styleFlag?: number;
}

type DecodeIssues = GeminiStructuredDecodeIssue[];

export function decodeGeminiAnnotation(wa: unknown, issues?: DecodeIssues): GeminiAnnotation | null {
    const decoded = decodeAnnotation(wa);
    if (!decoded && issues && !issues.length) {
        const flag: unknown = Array.isArray(wa) && Array.isArray(wa[2]) && Array.isArray(wa[2][0]) ? wa[2][0][4] : undefined;
        issues.push({ kind: 'annotation', ...(typeof flag === 'number' ? { styleFlag: flag } : {}) });
    }
    return decoded;
}

function decodeAnnotation(wa: unknown): GeminiAnnotation | null {
    if (!wa) return null;
    if (typeof wa === "object" && !Array.isArray(wa)) {
        const d = wa as Record<string, unknown>;
        const start = d.start;
        const end = d.end;
        const type = d.type;
        if (typeof start === 'number' && typeof end === 'number' && type === 'source'
            && Array.isArray(d.sourceIds) && d.sourceIds.length > 0
            && d.sourceIds.every(id => typeof id === 'string' && /^spp_[\w-]+$/.test(id))) {
            return { start, end, type, sourceIds: [...d.sourceIds] };
        }
        if (typeof start === "number" && typeof end === "number" && typeof type === "number") {
            // Supported inline annotation types:
            // 0: strong (bold)
            // 2: emphasis (italic)
            // 4: inline math
            // 5: subtle/italic emphasis
            // 6: link
            // 7: inline code
            // 12: strikethrough
            if ([0, 2, 4, 5, 6, 7, 12].includes(type)) {
                return {
                    start,
                    end,
                    type,
                    ...(typeof d.url === "string" ? { url: d.url } : {})
                };
            }
        }
        return null;
    }
    if (!Array.isArray(wa) || wa.length < 2) return null;
    const start = wa[0];
    const end = wa[1];
    if (typeof start !== "number" || typeof end !== "number") return null;

    const style = Array.isArray(wa[2]) ? wa[2] : [];
    const attribution: unknown = style[3];
    if (Array.isArray(attribution) && attribution.length === 2 && attribution[0] === null
        && Array.isArray(attribution[1]) && attribution[1].length > 0
        && attribution[1].every(id => typeof id === 'string' && /^spp_[\w-]+$/.test(id))
        && style.every((value, index) => value == null || index === 3)) {
        return { start, end, type: 'source', sourceIds: [...attribution[1]] };
    }
    if (attribution != null) return null;
    let t: number | null = null;
    let url: string | undefined;

    // In JSPB wire:
    // style[2] non-null -> type 4 (inline math)
    if (style.length > 2 && style[2] !== null && style[2] !== undefined) {
        t = 4;
    } else if (style.length > 0 && Array.isArray(style[0])) {
        const s0 = style[0];
        const flag = s0.length > 4 ? s0[4] : null;
        if (flag === 2) {
            t = 0; // strong (bold)
        } else if (flag === 1) {
            t = 5; // emphasis (subtle/italic)
        } else if (flag === 3) {
            t = 7; // inline code; captured RPC style flag, not internal annotation enum
        }
    } else if (style.length > 1 && Array.isArray(style[1])) {
        // link url or other formatting
        const s1 = style[1];
        if (s1.length > 0 && typeof s1[0] === "string") {
            t = 6;
            url = s1[0];
        }
    }

    // Fail closed: Unknown or unsupported annotation must NEVER be coerced or guessed as bold.
    if (t === null) {
        return null;
    }

    return {
        start,
        end,
        type: t,
        ...(url ? { url } : {})
    };
}

export function decodeGeminiStructuredNode(w: unknown, issues?: DecodeIssues): GeminiStructuredNode | null {
    const decoded = decodeStructuredNode(w, issues);
    if (!decoded && issues && !issues.length) {
        const nodeType = w && typeof w === 'object' && !Array.isArray(w) ? (w as Record<string, unknown>).nodeType : undefined;
        issues.push({ kind: 'node',
            ...(typeof nodeType === 'number' ? { nodeType } : {}),
            ...(Array.isArray(w) ? { fields: w.flatMap((value, index) => value == null ? [] : [index]) } : {}),
        });
    }
    return decoded;
}

function decodeStructuredNode(w: unknown, issues?: DecodeIssues): GeminiStructuredNode | null {
    if (!w) return null;
    if (typeof w === "object" && !Array.isArray(w)) {
        const node = w as Record<string, unknown>;
        const nodeType = node.nodeType;
        switch (nodeType) {
            case 'citationGroup': {
                if (!Array.isArray(node.children) || !node.children.length) return null;
                const children: GeminiFileCitation[] = [];
                for (const child of node.children) {
                    const decoded = decodeGeminiStructuredNode(child, issues);
                    if (decoded?.nodeType !== 'citation') return null;
                    children.push(decoded);
                }
                return { nodeType, children };
            }
            case 'paragraph': {
                if (!Array.isArray(node.children)) return null;
                const children: GeminiStructuredNode[] = [];
                for (const child of node.children) {
                    const decoded = decodeGeminiStructuredNode(child, issues);
                    if (!decoded) return null;
                    children.push(decoded);
                }
                return { nodeType, children };
            }
            case 'citation':
                return Number.isSafeInteger(node.number) && (node.number as number) > 0 && typeof node.title === 'string' && node.title
                    ? { nodeType, number: node.number as number, title: node.title } : null;
            case 18: {
                if (typeof node.text !== "string") return null;
                let annotations: GeminiAnnotation[] | undefined;
                if (Array.isArray(node.annotations)) {
                    annotations = [];
                    for (const a of node.annotations) {
                        const decoded = decodeGeminiAnnotation(a, issues);
                        if (!decoded) return null;
                        annotations.push(decoded);
                    }
                }
                return {
                    nodeType: 18,
                    text: node.text,
                    ...(typeof node.jJ === "number" ? { jJ: node.jJ } : {}),
                    ...(annotations !== undefined ? { annotations } : {})
                };
            }
            case 12: {
                if (typeof node.FTa !== "string") return null;
                return { nodeType: 12, FTa: node.FTa };
            }
            case 1: {
                if (typeof node.code !== "string") return null;
                return {
                    nodeType: 1,
                    code: node.code,
                    ...(typeof node.info === "string" ? { info: node.info } : {})
                };
            }
            case 24:
                return typeof node.id === 'string' && node.id && typeof node.title === 'string'
                    ? { nodeType: 24, id: node.id, title: node.title } : null;
            case 19:
            case 13:
            case 0:
                if (nodeType === 19) return { nodeType: 19 };
                if (nodeType === 13) return { nodeType: 13 };
                const rawXj = node.Xj;
                if (rawXj === undefined) return { nodeType: 0 };
                if (!Array.isArray(rawXj)) return null;
                const Xj = rawXj.filter((entry): entry is Record<string, unknown> =>
                    !!entry && typeof entry === "object" && !Array.isArray(entry));
                if (Xj.length !== rawXj.length) return null;
                return { nodeType: 0, Xj };
            case 15: {
                if (!Array.isArray(node.children)) return null;
                const children: GeminiStructuredNode[] = [];
                for (const c of node.children) {
                    const decoded = decodeGeminiStructuredNode(c, issues);
                    if (!decoded) return null;
                    children.push(decoded);
                }
                return { nodeType: 15, children };
            }
            case 20:
            case 14: {
                if (!Array.isArray(node.items)) return null;
                const items: GeminiListItem[] = [];
                for (const item of node.items) {
                    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
                    const itemRecord = item as Record<string, unknown>;
                    if (!Array.isArray(itemRecord.children)) return null;
                    const children: GeminiStructuredNode[] = [];
                    for (const c of itemRecord.children) {
                        const decoded = decodeGeminiStructuredNode(c, issues);
                        if (!decoded) return null;
                        children.push(decoded);
                    }
                    items.push({ children });
                }
                return nodeType === 20
                    ? { nodeType: 20, items }
                    : { nodeType: 14, items, ...(typeof node.VHa === "number" ? { VHa: node.VHa } : {}) };
            }
            case 17: {
                if (!Array.isArray(node.rows)) return null;
                const rows: GeminiTableRow[] = [];
                for (const row of node.rows) {
                    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
                    const rawCells = (row as Record<string, unknown>).cells;
                    if (!Array.isArray(rawCells)) return null;
                    const cells: GeminiTableCell[] = [];
                    for (const cell of rawCells) {
                        if (!cell || typeof cell !== "object" || Array.isArray(cell)) return null;
                        const cellRecord = cell as Record<string, unknown>;
                        if (!Array.isArray(cellRecord.children)) return null;
                        const children: GeminiStructuredNode[] = [];
                        for (const c of cellRecord.children) {
                            const decoded = decodeGeminiStructuredNode(c, issues);
                            if (!decoded) return null;
                            children.push(decoded);
                        }
                        cells.push({
                            children,
                            ...(typeof cellRecord.colSpan === "number" ? { colSpan: cellRecord.colSpan } : {}),
                            ...(typeof cellRecord.rowSpan === "number" ? { rowSpan: cellRecord.rowSpan } : {})
                        });
                    }
                    rows.push({ cells });
                }
                return { nodeType: 17, rows };
            }
            default:
                return null;
        }
    }
    if (!Array.isArray(w)) return null;

    // Captured file citation. The quote is source metadata, never visible body text.
    if (w[31] != null) {
        const payload: unknown = w[31];
        if (!w.every((value, index) => value == null || index === 31)
            || !Array.isArray(payload) || payload.length !== 1) return null;
        const citation: unknown = payload[0];
        if (!Array.isArray(citation) || citation.length !== 3
            || !Array.isArray(citation[0]) || citation[0].length !== 2 || citation[0][1] !== 0
            || typeof citation[0][0] !== 'string'
            || !Array.isArray(citation[1]) || !citation[1].length
            || !Array.isArray(citation[2]) || citation[2].length !== 2
            || typeof citation[2][0] !== 'string' || citation[2][1] !== 0) return null;
        const match = /^\[cite:\s*(\d+(?:\s*,\s*\d+)*)\]$/i.exec(citation[0][0]);
        if (!match) return null;
        const numbers = match[1].split(',').map(Number);
        if (numbers.length !== citation[1].length || new Set(numbers).size !== numbers.length
            || numbers.some(number => !Number.isSafeInteger(number) || number < 1)) return null;
        const children: GeminiFileCitation[] = [];
        for (const [index, source] of citation[1].entries()) {
            const file: unknown = Array.isArray(source) && source.length === 2 && source[0] === null ? source[1] : undefined;
            const metadata: unknown = Array.isArray(file) ? file[0] : undefined;
            if (!Array.isArray(file) || typeof file[6] !== 'string' || !file[6]
                || !Array.isArray(metadata) || metadata[2] !== file[6]
                || typeof metadata[11] !== 'string') return null;
            children.push({ nodeType: 'citation', number: numbers[index], title: file[6] });
        }
        return children.length === 1 ? children[0] : { nodeType: 'citationGroup', children };
    }

    if (w[13] != null) {
        const payload: unknown = w[13];
        if (!w.every((value, index) => value == null || index === 13)
            || !Array.isArray(payload) || payload.length !== 1 || !Array.isArray(payload[0]) || !payload[0].length) return null;
        const children: GeminiStructuredNode[] = [];
        for (const raw of payload[0]) {
            const child = decodeGeminiStructuredNode(raw, issues);
            if (!child) return null;
            children.push(child);
        }
        return { nodeType: 'paragraph', children };
    }

    // Field 34: Display Math
    if (w.length > 34 && w[34] !== null && w[34] !== undefined) {
        const mathPayload = w[34];
        const fta = Array.isArray(mathPayload) && mathPayload.length > 0 && typeof mathPayload[0] === "string"
            ? mathPayload[0]
            : "";
        return { nodeType: 12, FTa: fta };
    }

    // A generated code-document chip retains its position and source identity.
    if (Array.isArray(w[24]) && w[24].length === 1) {
        const chip: unknown = w[24][0];
        if (Array.isArray(chip) && chip[7] === 26 && typeof chip[1] === 'string' && chip[1]
            && typeof chip[3] === 'string') return { nodeType: 24, id: chip[1], title: chip[3] };
        return null;
    }

    // Field 23: Line break
    if (w.length > 23 && w[23] !== null && w[23] !== undefined) {
        return { nodeType: 13 };
    }

    // Field 19: Thematic break
    if (w.length > 19 && w[19] !== null && w[19] !== undefined) {
        return { nodeType: 19 };
    }

    // Captured native blockquote (field 16); field 15 is a legacy encoding.
    if (w[16] != null) {
        const payload: unknown = w[16];
        if (!w.every((value, index) => value == null || index === 16)
            || !Array.isArray(payload) || payload.length !== 1
            || !Array.isArray(payload[0]) || !payload[0].length) return null;
        const children: GeminiStructuredNode[] = [];
        for (const raw of payload[0]) {
            const child = decodeGeminiStructuredNode(raw, issues);
            if (!child) return null;
            children.push(child);
        }
        return { nodeType: 15, children };
    }

    // Field 15: Blockquote
    if (w.length > 15 && w[15] !== null && w[15] !== undefined) {
        const bqPayload = w[15];
        const rawChildren = Array.isArray(bqPayload) && bqPayload.length > 0 && Array.isArray(bqPayload[0])
            ? bqPayload[0]
            : [];
        const children: GeminiStructuredNode[] = [];
        for (const rc of rawChildren) {
            const dn = decodeGeminiStructuredNode(rc, issues);
            if (!dn) return null; // Fail closed on unsupported nested node
            children.push(dn);
        }
        return { nodeType: 15, children };
    }

    // Field 12: Ordered list
    if (w.length > 12 && w[12] !== null && w[12] !== undefined) {
        const olPayload = w[12];
        const rawItems = Array.isArray(olPayload) && olPayload.length > 0 && Array.isArray(olPayload[0])
            ? olPayload[0]
            : [];
        const items: GeminiListItem[] = [];
        for (const rit of rawItems) {
            const rawChildren = Array.isArray(rit) && rit.length > 0 && Array.isArray(rit[0]) ? rit[0] : [];
            const children: GeminiStructuredNode[] = [];
            for (const rc of rawChildren) {
                const dn = decodeGeminiStructuredNode(rc, issues);
                if (!dn) return null; // Fail closed on unsupported nested node
                children.push(dn);
            }
            items.push({ children });
        }
        const vha = Array.isArray(olPayload) && olPayload.length > 1 && typeof olPayload[1] === "number"
            ? olPayload[1]
            : 1;
        return { nodeType: 14, VHa: vha, items };
    }

    // Field 11: Unordered list
    if (w.length > 11 && w[11] !== null && w[11] !== undefined) {
        const ulPayload = w[11];
        const rawItems = Array.isArray(ulPayload) && ulPayload.length > 0 && Array.isArray(ulPayload[0])
            ? ulPayload[0]
            : [];
        const items: GeminiListItem[] = [];
        for (const rit of rawItems) {
            const rawChildren = Array.isArray(rit) && rit.length > 0 && Array.isArray(rit[0]) ? rit[0] : [];
            const children: GeminiStructuredNode[] = [];
            for (const rc of rawChildren) {
                const dn = decodeGeminiStructuredNode(rc, issues);
                if (!dn) return null; // Fail closed on unsupported nested node
                children.push(dn);
            }
            items.push({ children });
        }
        return { nodeType: 20, items };
    }

    // Field 10: Table
    if (w.length > 10 && w[10] !== null && w[10] !== undefined) {
        const tblPayload = w[10];
        const rawRows = Array.isArray(tblPayload) && tblPayload.length > 0 && Array.isArray(tblPayload[0])
            ? tblPayload[0]
            : [];
        const rows: GeminiTableRow[] = [];
        for (const rr of rawRows) {
            const rawCells = Array.isArray(rr) && rr.length > 1 && Array.isArray(rr[1]) ? rr[1] : [];
            const cells: GeminiTableCell[] = [];
            for (const rc of rawCells) {
                const rawChildren = Array.isArray(rc) && rc.length > 0 && Array.isArray(rc[0]) ? rc[0] : [];
                const children: GeminiStructuredNode[] = [];
                for (const rch of rawChildren) {
                    const dn = decodeGeminiStructuredNode(rch, issues);
                    if (!dn) return null; // Fail closed on unsupported nested node
                    children.push(dn);
                }
                const cellObj: GeminiTableCell = { children };
                if (Array.isArray(rc)) {
                    if (typeof rc[1] === "number" && rc[1] > 1) cellObj.colSpan = rc[1];
                    if (typeof rc[2] === "number" && rc[2] > 1) cellObj.rowSpan = rc[2];
                }
                cells.push(cellObj);
            }
            rows.push({ cells });
        }
        return { nodeType: 17, rows };
    }

    // Captured Imagen resource panel (field 9). Its image files are bound by
    // the shared resource pipeline, just like other nodeType 0 attachments.
    // Retain the complete panel rather than inventing body text from its prompt metadata.
    if (Array.isArray(w[9]) && w[9].length === 1 && Array.isArray(w[9][0]) && w[9][0].length > 0) {
        const panels: unknown[] = w[9][0];
        const knownPanels = w.every((value, index) => value == null || index === 9) && panels.every(panel => Array.isArray(panel) && panel.length === 12
            && Array.isArray(panel[0]) && Array.isArray(panel[1])
            && typeof panel[1][0] === 'string'
            && /^https?:\/\/googleusercontent\.com\/image_generation_content\//.test(panel[1][0])
            && extractImageEvidence(panel[0]).some(image => image.isGenerated));
        if (knownPanels) return { nodeType: 0, Xj: [{ generatedImagePayload: w[9] }] };
        return null;
    }

    // Field 3: Code block
    if (w.length > 3 && w[3] !== null && w[3] !== undefined) {
        const codePayload = w[3];
        const code = Array.isArray(codePayload) && typeof codePayload[0] === "string" ? codePayload[0] : "";
        const info = Array.isArray(codePayload) && typeof codePayload[1] === "string" ? codePayload[1] : undefined;
        return { nodeType: 1, code, ...(info ? { info } : {}) };
    }

    // Field 1: Text / Heading / Paragraph
    if (w.length > 1 && w[1] !== null && w[1] !== undefined) {
        const textPayload = w[1];
        if (Array.isArray(textPayload)) {
            const text = typeof textPayload[2] === "string" ? textPayload[2] : "";
            const jJ = typeof textPayload[1] === "number" && textPayload[1] > 0 ? textPayload[1] : undefined;
            const rawAnnots = Array.isArray(textPayload[3]) ? textPayload[3] : [];
            const annotations: GeminiAnnotation[] = [];
            for (const ra of rawAnnots) {
                const da = decodeGeminiAnnotation(ra, issues);
                if (!da) return null; // Fail closed on unknown annotation
                annotations.push(da);
            }
            return {
                nodeType: 18,
                text,
                ...(jJ ? { jJ } : {}),
                ...(annotations.length ? { annotations } : {})
            };
        }
    }

    // Captured live execution panels use extension 39 in the field-0 envelope.
    // Preserve their original code/stdout fence identity instead of treating
    // every extension object as an attachment and silently dropping its body.
    const extension = w[0];
    if (extension && typeof extension === 'object' && !Array.isArray(extension) && '39' in extension) {
        const event: unknown = (extension as Record<string, unknown>)['39'];
        if (!Array.isArray(event) || event.length !== 5 || typeof event[0] !== 'string'
            || typeof event[1] !== 'string' || !/^[\w+-]+$/.test(event[1])
            || !Number.isInteger(event[2]) || event[2] < 1 || event[3] !== null || ![0, 1].includes(event[4])) return null;
        return { nodeType: 1, code: event[0],
            info: `${event[1]}?${event[4] === 0 ? 'code_reference' : 'code_stdout'}&code_event_index=${event[2]}` };
    }

    // Field 0 or 2: Attachments / follow-up chips
    if ((w.length > 0 && w[0] !== null && typeof w[0] === 'object' && !Array.isArray(w[0])) ||
        (w.length >= 3 && w[0] === null && w[1] === null && w[2] !== null)) {
        return { nodeType: 0 };
    }

    return null;
}

export function decodeGeminiStructuredPayload(raw: unknown, issues?: DecodeIssues): GeminiStructuredDocument | null {
    if (!raw) return null;

    // Case 1: Already structured document object
    if (typeof raw === "object" && !Array.isArray(raw)) {
        const doc = raw as Record<string, unknown>;
        if (Array.isArray(doc.children)) {
            const children: GeminiStructuredNode[] = [];
            for (const ch of doc.children) {
                const node = decodeGeminiStructuredNode(ch, issues);
                if (node) children.push(node);
                else return null;
            }
            return { children };
        }
        return null;
    }

    // Case 2: Array payload (wire format or array of nodes)
    if (Array.isArray(raw)) {
        let nodeArray: unknown[] = raw;
        // Captured Imagen documents add an empty metadata trailer: [[[nodes]], []].
        // Nonempty trailers remain unsupported; never discard unknown metadata.
        if (nodeArray.length === 2 && Array.isArray(nodeArray[1]) && nodeArray[1].length === 0
            && Array.isArray(nodeArray[0]) && nodeArray[0].length === 1 && Array.isArray(nodeArray[0][0])) {
            nodeArray = [nodeArray[0]];
        }
        // Turn field 12 envelope in JSPB: [ [ [ node_0, node_1, ... ] ] ]
        if (nodeArray.length === 1 && Array.isArray(nodeArray[0])) {
            if (nodeArray[0].length === 1 && Array.isArray(nodeArray[0][0])) {
                nodeArray = nodeArray[0][0] as unknown[];
            } else if (nodeArray[0].length > 1 && Array.isArray(nodeArray[0][0])) {
                nodeArray = nodeArray[0] as unknown[];
            }
        }

        const children: GeminiStructuredNode[] = [];
        for (const item of nodeArray) {
            const node = decodeGeminiStructuredNode(item, issues);
            if (node) {
                children.push(node);
            } else {
                return null;
            }
        }
        return { children };
    }

    return null;
}

export type GeminiStructuredExtraction =
    | { status: 'decoded'; document: GeminiStructuredDocument }
    | { status: 'missing' | 'candidate_unmatched' }
    | { status: 'decode_rejected'; issue: GeminiStructuredDecodeIssue };

export function inspectStructuredContent(turn: unknown, cand?: unknown, candidateIndex = 0): GeminiStructuredExtraction {
    const getStructuredContent = (value: unknown): unknown => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
        return (value as Record<string, unknown>).structuredContent;
    };
    const decode = (raw: unknown): GeminiStructuredExtraction => {
        const issues: DecodeIssues = [];
        const document = decodeGeminiStructuredPayload(raw, issues);
        return document ? { status: 'decoded', document }
            : { status: 'decode_rejected', issue: issues[0] ?? { kind: 'payload' } };
    };
    const candidateContent = getStructuredContent(cand);
    if (candidateContent != null) return decode(candidateContent);

    const turnContent = getStructuredContent(turn);
    const modelPayload: unknown = Array.isArray(turn) ? turn[GEMINI_JSPB_SCHEMA.TURN.MODEL_PAYLOAD] : undefined;
    const raw = turnContent ?? (Array.isArray(modelPayload)
        ? modelPayload[GEMINI_JSPB_SCHEMA.MODEL_PAYLOAD.STRUCTURED_CONTENT ?? 12] : undefined);
    if (raw == null) return { status: 'missing' };
    // turn[3][12] is proven to belong only to the primary candidate (PR #705).
    if (candidateIndex !== 0) return { status: 'candidate_unmatched' };
    return decode(raw);
}

export function extractStructuredContent(turn: unknown, cand?: unknown, candidateIndex = 0): GeminiStructuredDocument | undefined {
    const result = inspectStructuredContent(turn, cand, candidateIndex);
    return result.status === 'decoded' ? result.document : undefined;
}
