import { extractImageEvidence, type ImageAttachment } from "./sourceAttachments.js";
import { isJsonValue, type JsonValue } from "../../../../shared/utils/jsonTypes.js";
import {
    decodeBusinessCard,
    decodeDocumentLinks,
    decodeFinanceCard,
    decodeFlightCard,
    decodeMailCard,
    decodeMapCard,
    decodeResearchPlan,
} from './cardNodes.js';
import { isGeminiSourceId } from './sourceAttributions.js';
import {
    GEMINI_ANNOTATION_TYPES,
    GEMINI_NODE_TYPES,
    GEMINI_WIRE_NODE_SLOTS,
    GEMINI_WIRE_STYLE_FLAGS,
    isExclusiveSlot,
    isHttpUrl,
    isHttpsUrl,
    isIntegerInRange,
    isNonEmptyString,
    isNonNegativeSafeInt,
    isOptionalString,
    isPositiveSafeInt,
    isWireArray,
    isWireRecord,
    singleExtensionPayload,
    singleWireSlot,
} from './jspbSchema.js';

export { GEMINI_ANNOTATION_TYPES, GEMINI_NODE_TYPES };

import type {
    GeminiAnnotation,
    GeminiAttachmentNode,
    GeminiCitationGroup,
    GeminiCitationReference,
    GeminiCitationSource,
    GeminiCodeBlockNode,
    GeminiCompositeParagraph,
    GeminiFileCitation,
    GeminiFileNode,
    GeminiLineBreakNode,
    GeminiListItem,
    GeminiMarkupNode,
    GeminiMathBlockNode,
    GeminiOrderedListNode,
    GeminiPartialStructuredSlot,
    GeminiQuoteNode,
    GeminiSourceReference,
    GeminiStructuredDocument,
    GeminiStructuredFragment,
    GeminiStructuredNode,
    GeminiTableCell,
    GeminiTableNode,
    GeminiTableRow,
    GeminiTextNode,
    GeminiThematicBreakNode,
    GeminiUnorderedListNode,
} from './types.js';
export type {
    GeminiAnnotation,
    GeminiAttachmentNode,
    GeminiCitationGroup,
    GeminiCitationReference,
    GeminiCitationSource,
    GeminiCodeBlockNode,
    GeminiCompositeParagraph,
    GeminiFileCitation,
    GeminiFileNode,
    GeminiLineBreakNode,
    GeminiMarkupNode,
    GeminiOrderedListNode,
    GeminiPartialStructuredSlot,
    GeminiQuoteNode,
    GeminiSourceReference,
    GeminiStructuredDocument,
    GeminiStructuredFragment,
    GeminiStructuredNode,
    GeminiTableNode,
    GeminiTextNode,
    GeminiThematicBreakNode,
    GeminiUnorderedListNode,
} from './types.js';

export function headingLevelOf(node: GeminiTextNode): number | undefined {
    return node.jJ;
}

export function mathSourceOf(node: GeminiMathBlockNode): string {
    return node.FTa;
}

export function orderedListStartOf(node: GeminiOrderedListNode): number {
    return node.VHa ?? 1;
}

/** Local diagnostic evidence. Raw values may contain source text, URLs and file tokens. */
export interface GeminiStructuredDecodeIssue {
    kind: 'annotation' | 'node' | 'payload';
    nodeType?: number;
    fields?: number[];
    styleFlag?: number;
    rawValue?: JsonValue;
    /** JSON Pointer relative to rawDocument; the empty string denotes its root. */
    path?: string;
}

type DecodeIssues = GeminiStructuredDecodeIssue[];

/** Source annotations in both RPC wire tuples and runtime objects use
 * the same source-ID grammar and never leak unchecked arrays. */
function decodeSourceIds(value: unknown): string[] | null {
    if (!isWireArray(value) || value.length === 0) return null;
    return value.every(isGeminiSourceId) ? [...value] : null;
}

/** Citation sources are a wire union: Workspace, uploaded file, or web page.
 * Excerpts and highlight regions describe the source, not authored body text. */
function decodeCitationSource(source: unknown, number?: number): GeminiCitationSource | null {
    if (!isWireArray(source)) return null;
    const workspace = source.length === 1
        || (source.length === 3 && source[1] === null && source[2] === '') ? source[0] : undefined;
    if (isWireArray(workspace) && isWireArray(workspace[0]) && workspace[0].length === 1
        && typeof workspace[0][0] === 'number' && [1, 2, 3].includes(workspace[0][0])
        && isHttpsUrl(workspace[1]) && isNonEmptyString(workspace[2])
        && (workspace.length === 3 || (workspace.length >= 12
            && isWireArray(workspace[3]) && workspace[3].length > 0
            && workspace[3].every(id => typeof id === 'string') && workspace[11] === 4))) {
        return { title: workspace[2], url: workspace[1] };
    }
    if (source[0] === null && (source.length === 2
        || (source.length === 3 && typeof source[2] === 'string')
        || (source.length === 5 && typeof source[2] === 'string' && source[3] === null
            && isWireArray(source[4]) && isJsonValue(source[4])))) {
        const file = source[1];
        const metadata = isWireArray(file) ? file[0] : undefined;
        if (isWireArray(file) && isWireArray(metadata) && isNonEmptyString(metadata[2])
            && typeof metadata[11] === 'string'
            && (file[6] === metadata[2] || (file.length === 5 && typeof source[2] === 'string'
                && isPositiveSafeInt(file[4])))) {
            return { title: metadata[2] };
        }
    }
    if (source.length === 4 && source.slice(0, 3).every(value => value === null)) {
        const page = source[3];
        const metadata = isWireArray(page) ? page[0] : undefined;
        const title = isWireArray(metadata) ? metadata[metadata.length === 2 ? 1 : 2] : undefined;
        if (isWireArray(page) && page.length === 6 && isPositiveSafeInt(page[1])
            && (number === undefined || page[1] === number)
            && isWireArray(metadata) && metadata.length >= 2
            && isHttpsUrl(metadata[0])
            && (metadata.length === 2 || isHttpsUrl(metadata[1]))
            && isNonEmptyString(title)
            && isWireArray(page[5]) && isJsonValue(page[5])) {
            return { title, url: metadata[0] };
        }
    }
    return null;
}

function citationTokens(marker: string): string[] | null {
    const match = /^\[cite:\s*(\d+(?:[.-]\d+)?(?:\s*,\s*\d+(?:[.-]\d+)?)*)\]$/i.exec(marker.trim());
    if (!match) return null;
    const tokens = match[1].split(',').map(token => token.trim());
    const identities = tokens.map(token => /^\d+$/.test(token) ? Number(token) : token);
    if (new Set(identities).size !== tokens.length || tokens.some(token => {
        const parts = token.split(/[.-]/).map(Number);
        return parts.some(part => !isPositiveSafeInt(part))
            || (token.includes('-') && parts[0] > parts[1]);
    })) return null;
    return tokens;
}

/** Field 31 and the selected candidate's field 44 carry the same source-reference tuple. */
export function decodeGeminiCitationReference(citation: unknown): GeminiCitationReference | null {
    if (isWireArray(citation) && citation.length === 1 && isWireArray(citation[0])
        && citation[0].length === 1 && typeof citation[0][0] === 'string'
        && /^\s*\[cite:\s*\]\s*$/.test(citation[0][0])) {
        return { nodeType: 'citationGroup', children: [] };
    }
    if (!isWireArray(citation) || citation.length < 2 || citation.length > 4
        || !isWireArray(citation[0]) || (citation[0].length !== 1 && citation[0].length !== 2)
        || (citation[0].length === 2 && citation[0][1] !== 0)
        || typeof citation[0][0] !== 'string'
        || !isWireArray(citation[1]) || !citation[1].length) return null;
    if (citation.length >= 3 && (!isWireArray(citation[2]) || citation[2].length !== 2
        || typeof citation[2][0] !== 'string' || !isNonNegativeSafeInt(citation[2][1]))) return null;
    if (citation.length === 4 && (!isWireArray(citation[3]) || citation[3].length !== 2
        || citation[3][0] !== '[cite_start]' || !isNonNegativeSafeInt(citation[3][1]))) return null;
    const tokens = citationTokens(citation[0][0]);
    if (!tokens) return null;
    const oneToOne = tokens.length === citation[1].length;
    if (!oneToOne && (citation[1].length > tokens.length || !citation[1].every(source =>
        isWireArray(source) && source[0] === null && typeof source[2] === 'string'))) return null;
    const numbered = oneToOne && tokens.every(token => /^\d+$/.test(token));
    const sources: GeminiCitationSource[] = [];
    const children: GeminiFileCitation[] = [];
    for (const [index, source] of citation[1].entries()) {
        const decoded = decodeCitationSource(source, numbered ? Number(tokens[index]) : undefined);
        if (!decoded) return null;
        sources.push(decoded);
        if (numbered) children.push({ nodeType: 'citation', number: Number(tokens[index]), ...decoded });
    }
    if (!numbered) return { nodeType: 'sourceReference', marker: `[cite: ${tokens.join(', ')}]`, sources };
    return children.length === 1 ? children[0] : { nodeType: 'citationGroup', children };
}

export function decodeGeminiAnnotation(wa: unknown, issues?: DecodeIssues): GeminiAnnotation | null {
    const decoded = decodeAnnotation(wa);
    if (!decoded && issues && !issues.length) {
        const flag = isWireArray(wa) && isWireArray(wa[2]) && isWireArray(wa[2][0]) ? wa[2][0][4] : undefined;
        issues.push({
            kind: 'annotation',
            ...(typeof flag === 'number' ? { styleFlag: flag } : {}),
            ...(isJsonValue(wa) ? { rawValue: wa } : {}),
        });
    }
    return decoded;
}

const STYLE_FLAG_TO_ANNOTATION: Readonly<Record<number, 0 | 5 | 7 | 12>> = {
    [GEMINI_WIRE_STYLE_FLAGS.EMPHASIS]: GEMINI_ANNOTATION_TYPES.SUBTLE_EMPHASIS,
    [GEMINI_WIRE_STYLE_FLAGS.STRONG]: GEMINI_ANNOTATION_TYPES.STRONG,
    [GEMINI_WIRE_STYLE_FLAGS.INLINE_CODE]: GEMINI_ANNOTATION_TYPES.INLINE_CODE,
    [GEMINI_WIRE_STYLE_FLAGS.STRIKETHROUGH]: GEMINI_ANNOTATION_TYPES.STRIKETHROUGH,
};

function decodeAnnotation(wa: unknown): GeminiAnnotation | null {
    if (!wa) return null;
    if (isWireRecord(wa)) {
        const { start, end, type, url, sourceIds: rawIds } = wa;
        if (typeof start !== 'number' || typeof end !== 'number') return null;
        if (type === 'source') {
            const sourceIds = decodeSourceIds(rawIds);
            return sourceIds ? { start, end, type, sourceIds } : null;
        }
        if (type === GEMINI_ANNOTATION_TYPES.LINK) {
            return typeof url === 'string' && url.trim() ? { start, end, type, url } : null;
        }
        if (type === 0 || type === 2 || type === 4 || type === 5 || type === 7 || type === 12) {
            return { start, end, type };
        }
        return null;
    }
    if (!isWireArray(wa) || wa.length < 2) return null;
    const [start, end, rawStyle] = wa;
    if (typeof start !== 'number' || typeof end !== 'number') return null;

    const style = isWireArray(rawStyle) ? rawStyle : [];
    const attribution = style[3];
    if (isWireArray(attribution)) {
        if (attribution.length === 2 && attribution[0] === null) {
            const sourceIds = decodeSourceIds(attribution[1]);
            if (sourceIds && isExclusiveSlot(style, 3)) {
                return { start, end, type: 'source', sourceIds };
            }
        }
        const reference = attribution.length === 1 ? attribution[0] : undefined;
        if (isWireArray(reference) && reference.length === 3 && reference[0] === null && reference[1] === null
            && typeof reference[2] === 'string' && /^(?:cit_[\w-]+|0)$/.test(reference[2])
            && isExclusiveSlot(style, 3)) {
            return { start, end, type: 'source', sourceIds: [reference[2]] };
        }
    }
    if (attribution != null) return null;

    const preview = isWireArray(style[5]) && isWireArray(style[5][6]) ? style[5][6][0] : undefined;
    if (isWireArray(preview) && isHttpUrl(preview[12])
        && typeof preview[13] === 'string' && isExclusiveSlot(style, 5)) {
        return { start, end, type: GEMINI_ANNOTATION_TYPES.LINK, url: preview[12] };
    }
    const placeLink = isWireArray(style[5]) && style[5].length === 1 ? style[5][0] : undefined;
    const linkTarget = isWireArray(placeLink) && isWireArray(placeLink[1]) && placeLink[1].length === 1 ? placeLink[1][0] : undefined;
    if (isWireArray(placeLink) && isWireArray(placeLink[0]) && typeof placeLink[0][0] === 'string'
        && placeLink[4] === 2 && isWireArray(placeLink[5]) && isHttpUrl(linkTarget)
        && isExclusiveSlot(style, 5)) {
        return { start, end, type: GEMINI_ANNOTATION_TYPES.LINK, url: linkTarget };
    }

    if (style.length > 2 && style[2] != null) {
        return { start, end, type: GEMINI_ANNOTATION_TYPES.INLINE_MATH };
    }
    if (style.length > 0 && isWireArray(style[0])) {
        const flag = style[0].length > 4 ? style[0][4] : null;
        const mapped = typeof flag === 'number' ? STYLE_FLAG_TO_ANNOTATION[flag] : undefined;
        return mapped !== undefined ? { start, end, type: mapped } : null;
    }
    if (style.length > 1 && isWireArray(style[1])) {
        const target = style[1][0];
        return typeof target === 'string' && target.trim()
            ? { start, end, type: GEMINI_ANNOTATION_TYPES.LINK, url: target } : null;
    }
    return null;
}

function decodeStructuredChildren(rawChildren: unknown, issues?: DecodeIssues): GeminiStructuredNode[] | null {
    if (!isWireArray(rawChildren)) return null;
    const children: GeminiStructuredNode[] = [];
    for (const raw of rawChildren) {
        const decoded = decodeGeminiStructuredNode(raw, issues);
        if (!decoded) return null;
        children.push(decoded);
    }
    return children;
}

function decodeBlockquotePayload(payload: unknown, issues?: DecodeIssues): GeminiQuoteNode | null {
    if (!isWireArray(payload) || payload.length > 1) return null;
    const rawChildren = payload.length === 0 ? [] : payload[0];
    const children = decodeStructuredChildren(rawChildren, issues);
    return children ? { nodeType: GEMINI_NODE_TYPES.BLOCKQUOTE, children } : null;
}

function decodeWireListItems(rawItems: unknown, issues?: DecodeIssues): GeminiListItem[] | null {
    if (!isWireArray(rawItems)) return null;
    const items: GeminiListItem[] = [];
    for (const rawItem of rawItems) {
        if (!isWireArray(rawItem)) return null;
        const children = decodeStructuredChildren(rawItem[0], issues);
        if (!children) return null;
        items.push({ children });
    }
    return items;
}

export function decodeGeminiStructuredNode(w: unknown, issues?: DecodeIssues): GeminiStructuredNode | null {
    const decoded = decodeStructuredNode(w, issues);
    if (!decoded && issues && !issues.length) {
        const nodeType = isWireRecord(w) ? w.nodeType : undefined;
        issues.push({
            kind: 'node',
            ...(typeof nodeType === 'number' ? { nodeType } : {}),
            ...(isWireArray(w) ? { fields: w.flatMap((value, index) => value == null ? [] : [index]) } : {}),
            ...(isJsonValue(w) ? { rawValue: w } : {}),
        });
    }
    return decoded;
}

function decodeRuntimeStructuredRecord(node: Record<string, unknown>, issues?: DecodeIssues): GeminiStructuredNode | null {
    const nodeType = node.nodeType;
    switch (nodeType) {
        case 'markup':
            return (node.format === 'html' || node.format === 'markdown') && typeof node.source === 'string'
                ? { nodeType, format: node.format, source: node.source } : null;
        case 'sourceReference': {
            const tokens = typeof node.marker === 'string' ? citationTokens(node.marker) : null;
            if (!tokens || !isWireArray(node.sources) || !node.sources.length) return null;
            const sources: GeminiCitationSource[] = [];
            for (const source of node.sources) {
                if (!isWireRecord(source) || !isNonEmptyString(source.title)
                    || (source.url !== undefined && !isHttpsUrl(source.url))) return null;
                sources.push({ title: source.title, ...(typeof source.url === 'string' ? { url: source.url } : {}) });
            }
            return { nodeType, marker: `[cite: ${tokens.join(', ')}]`, sources };
        }
        case 'citationGroup': {
            if (!isWireArray(node.children)) return null;
            const children: GeminiFileCitation[] = [];
            for (const child of node.children) {
                const decoded = decodeGeminiStructuredNode(child, issues);
                if (decoded?.nodeType !== 'citation') return null;
                children.push(decoded);
            }
            return { nodeType, children };
        }
        case 'fragment':
        case 'paragraph': {
            const children = decodeStructuredChildren(node.children, issues);
            return children ? { nodeType, children } : null;
        }
        case 'citation': {
            const number = node.number;
            return isPositiveSafeInt(number) && isNonEmptyString(node.title)
                && (node.url === undefined || isHttpsUrl(node.url))
                ? { nodeType, number, title: node.title, ...(typeof node.url === 'string' ? { url: node.url } : {}) } : null;
        }
        case GEMINI_NODE_TYPES.TEXT_BLOCK: {
            if (typeof node.text !== 'string') return null;
            if (node.annotations !== undefined && !isWireArray(node.annotations)) return null;
            let annotations: GeminiAnnotation[] | undefined;
            if (isWireArray(node.annotations)) {
                annotations = [];
                for (const a of node.annotations) {
                    const decoded = decodeGeminiAnnotation(a, issues);
                    if (!decoded) return null;
                    annotations.push(decoded);
                }
            }
            return {
                nodeType: GEMINI_NODE_TYPES.TEXT_BLOCK,
                text: node.text,
                ...(typeof node.jJ === 'number' ? { jJ: node.jJ } : {}),
                ...(annotations !== undefined ? { annotations } : {}),
            };
        }
        case GEMINI_NODE_TYPES.MATH_BLOCK:
            return typeof node.FTa === 'string' ? { nodeType: GEMINI_NODE_TYPES.MATH_BLOCK, FTa: node.FTa } : null;
        case GEMINI_NODE_TYPES.CODE_BLOCK:
            return typeof node.code === 'string' ? {
                nodeType: GEMINI_NODE_TYPES.CODE_BLOCK,
                code: node.code,
                ...(typeof node.info === 'string' ? { info: node.info } : {}),
            } : null;
        case GEMINI_NODE_TYPES.GENERATED_FILE:
            return isNonEmptyString(node.id) && typeof node.title === 'string'
                ? { nodeType: GEMINI_NODE_TYPES.GENERATED_FILE, id: node.id, title: node.title } : null;
        case GEMINI_NODE_TYPES.THEMATIC_BREAK:
            return { nodeType: GEMINI_NODE_TYPES.THEMATIC_BREAK };
        case GEMINI_NODE_TYPES.LINE_BREAK:
            return { nodeType: GEMINI_NODE_TYPES.LINE_BREAK };
        case GEMINI_NODE_TYPES.ATTACHMENT: {
            const rawXj = node.Xj;
            if (rawXj === undefined) return { nodeType: GEMINI_NODE_TYPES.ATTACHMENT };
            if (!isWireArray(rawXj) || rawXj.some(entry => !isJsonValue(entry) || !isWireRecord(entry))) return null;
            return { nodeType: GEMINI_NODE_TYPES.ATTACHMENT, images: extractImageEvidence(rawXj) };
        }
        case GEMINI_NODE_TYPES.BLOCKQUOTE: {
            const children = decodeStructuredChildren(node.children, issues);
            return children ? { nodeType: GEMINI_NODE_TYPES.BLOCKQUOTE, children } : null;
        }
        case GEMINI_NODE_TYPES.UNORDERED_LIST:
        case GEMINI_NODE_TYPES.ORDERED_LIST: {
            if (!isWireArray(node.items)) return null;
            const items: GeminiListItem[] = [];
            for (const item of node.items) {
                if (!isWireRecord(item)) return null;
                const children = decodeStructuredChildren(item.children, issues);
                if (!children) return null;
                items.push({ children });
            }
            return nodeType === GEMINI_NODE_TYPES.UNORDERED_LIST
                ? { nodeType: GEMINI_NODE_TYPES.UNORDERED_LIST, items }
                : { nodeType: GEMINI_NODE_TYPES.ORDERED_LIST, items, ...(typeof node.VHa === 'number' ? { VHa: node.VHa } : {}) };
        }
        case GEMINI_NODE_TYPES.TABLE: {
            if (!isWireArray(node.rows)) return null;
            const rows: GeminiTableRow[] = [];
            for (const row of node.rows) {
                if (!isWireRecord(row) || !isWireArray(row.cells)) return null;
                const cells: GeminiTableCell[] = [];
                for (const cell of row.cells) {
                    if (!isWireRecord(cell)) return null;
                    const children = decodeStructuredChildren(cell.children, issues);
                    if (!children) return null;
                    cells.push({
                        children,
                        ...(typeof cell.colSpan === 'number' ? { colSpan: cell.colSpan } : {}),
                        ...(typeof cell.rowSpan === 'number' ? { rowSpan: cell.rowSpan } : {}),
                    });
                }
                rows.push({ cells });
            }
            return { nodeType: GEMINI_NODE_TYPES.TABLE, rows };
        }
        default:
            return null;
    }
}

function decodeStructuredNode(w: unknown, issues?: DecodeIssues): GeminiStructuredNode | null {
    if (!w) return null;
    if (isWireRecord(w)) return decodeRuntimeStructuredRecord(w, issues);
    if (!isWireArray(w)) return null;

    // Explicit empty placeholders carry no authored content; arbitrary null/nonempty tuples still reject.
    if (w.length === 0 || (w.length === 1 && isWireArray(w[0]) && w[0].length === 0)) {
        return { nodeType: 'fragment', children: [] };
    }

    const active = singleWireSlot(w);
    if (!active) return null;
    const { slot, payload } = active;

    switch (slot) {
        case GEMINI_WIRE_NODE_SLOTS.RESEARCH_PLAN:
            return decodeResearchPlan(payload);
        case GEMINI_WIRE_NODE_SLOTS.FLIGHT_CARD:
            return decodeFlightCard(payload);
        case GEMINI_WIRE_NODE_SLOTS.BUSINESS_CARD:
            return decodeBusinessCard(payload);
        case GEMINI_WIRE_NODE_SLOTS.MAP_CARD:
            return decodeMapCard(payload);
        case GEMINI_WIRE_NODE_SLOTS.FINANCE_CARD:
            return decodeFinanceCard(payload);
        case GEMINI_WIRE_NODE_SLOTS.MAIL_CARD:
            return decodeMailCard(payload);
        case GEMINI_WIRE_NODE_SLOTS.SOURCE_REFERENCE:
            return isWireArray(payload) && payload.length === 1 ? decodeGeminiCitationReference(payload[0]) : null;
        case GEMINI_WIRE_NODE_SLOTS.COMPOSITE_TEXT: {
            if (!isWireArray(payload) || payload.length !== 1 || !isWireArray(payload[0]) || !payload[0].length) return null;
            const children = decodeStructuredChildren(payload[0], issues);
            return children ? { nodeType: 'paragraph', children } : null;
        }
        case GEMINI_WIRE_NODE_SLOTS.MATH_BLOCK:
            return isWireArray(payload) && typeof payload[0] === 'string'
                ? { nodeType: GEMINI_NODE_TYPES.MATH_BLOCK, FTa: payload[0] } : null;
        case GEMINI_WIRE_NODE_SLOTS.DOCUMENT_CHIP: {
            if (!isWireArray(payload)) return null;
            const chip = payload[0];
            if (payload.length === 1 && isWireArray(chip) && chip[7] === 26 && isNonEmptyString(chip[1]) && typeof chip[3] === 'string') {
                return { nodeType: GEMINI_NODE_TYPES.GENERATED_FILE, id: chip[1], title: chip[3] };
            }
            return decodeDocumentLinks(payload);
        }
        case GEMINI_WIRE_NODE_SLOTS.LINE_BREAK:
            return { nodeType: GEMINI_NODE_TYPES.LINE_BREAK };
        case GEMINI_WIRE_NODE_SLOTS.THEMATIC_BREAK:
            return { nodeType: GEMINI_NODE_TYPES.THEMATIC_BREAK };
        case GEMINI_WIRE_NODE_SLOTS.BLOCKQUOTE:
        case GEMINI_WIRE_NODE_SLOTS.LEGACY_BLOCKQUOTE:
            return decodeBlockquotePayload(payload, issues);
        case GEMINI_WIRE_NODE_SLOTS.ORDERED_LIST: {
            if (!isWireArray(payload)) return null;
            const items = decodeWireListItems(payload.length === 0 ? [] : payload[0], issues);
            if (!items || (payload[1] != null && !isPositiveSafeInt(payload[1]))) return null;
            return { nodeType: GEMINI_NODE_TYPES.ORDERED_LIST, VHa: typeof payload[1] === 'number' ? payload[1] : 1, items };
        }
        case GEMINI_WIRE_NODE_SLOTS.UNORDERED_LIST: {
            if (!isWireArray(payload)) return null;
            const items = decodeWireListItems(payload.length === 0 ? [] : payload[0], issues);
            return items ? { nodeType: GEMINI_NODE_TYPES.UNORDERED_LIST, items } : null;
        }
        case GEMINI_WIRE_NODE_SLOTS.TABLE: {
            if (!isWireArray(payload)) return null;
            const rawRows = payload.length === 0 ? [] : payload[0];
            if (!isWireArray(rawRows)) return null;
            const rows: GeminiTableRow[] = [];
            for (const rr of rawRows) {
                if (!isWireArray(rr) || !isWireArray(rr[1])) return null;
                const cells: GeminiTableCell[] = [];
                for (const rc of rr[1]) {
                    if (!isWireArray(rc)) return null;
                    const children = decodeStructuredChildren(rc[0], issues);
                    if (!children) return null;
                    const cellObj: GeminiTableCell = { children };
                    if (typeof rc[1] === 'number' && rc[1] > 1) cellObj.colSpan = rc[1];
                    if (typeof rc[2] === 'number' && rc[2] > 1) cellObj.rowSpan = rc[2];
                    cells.push(cellObj);
                }
                rows.push({ cells });
            }
            return { nodeType: GEMINI_NODE_TYPES.TABLE, rows };
        }
        case GEMINI_WIRE_NODE_SLOTS.IMAGEN_PANEL: {
            if (!isWireArray(payload) || payload.length !== 1 || !isWireArray(payload[0]) || !payload[0].length) return null;
            const panels = payload[0];
            const knownPanels = panels.every(panel => isWireArray(panel) && panel.length === 12
                && isWireArray(panel[0]) && isWireArray(panel[1])
                && typeof panel[1][0] === 'string'
                && /^https?:\/\/googleusercontent\.com\/image_generation_content\//.test(panel[1][0])
                && extractImageEvidence(panel[0]).some(image => image.isGenerated));
            if (knownPanels && isJsonValue(payload)) {
                return { nodeType: GEMINI_NODE_TYPES.ATTACHMENT, images: extractImageEvidence(payload) };
            }
            const images: ImageAttachment[] = [];
            for (const panel of panels) {
                if (!isWireArray(panel) || panel.length !== 12 || !isWireArray(panel[0]) || !isWireArray(panel[0][3])
                    || !isWireArray(panel[1]) || panel[1].length !== 1 || !isHttpUrl(panel[1][0])) return null;
                const mimeType = panel[0][3][11];
                if (typeof mimeType !== 'string' || !/^image\/[\w.+-]+$/.test(mimeType)) return null;
                images.push({ sourceUrl: panel[1][0], mimeType });
            }
            return images.length ? { nodeType: GEMINI_NODE_TYPES.ATTACHMENT, images } : null;
        }
        case GEMINI_WIRE_NODE_SLOTS.CODE_BLOCK: {
            if (!isWireArray(payload) || typeof payload[0] !== 'string' || !isOptionalString(payload[1])) return null;
            const info = typeof payload[1] === 'string' ? payload[1] : undefined;
            return { nodeType: GEMINI_NODE_TYPES.CODE_BLOCK, code: payload[0], ...(info ? { info } : {}) };
        }
        case GEMINI_WIRE_NODE_SLOTS.TEXT_BLOCK: {
            if (!isWireArray(payload) || typeof payload[2] !== 'string'
                || (payload[1] != null && !isIntegerInRange(payload[1], 0, 6))
                || (payload[3] != null && !isWireArray(payload[3]))) return null;
            const jJ = typeof payload[1] === 'number' && payload[1] > 0 ? payload[1] : undefined;
            const rawAnnots = isWireArray(payload[3]) ? payload[3] : [];
            const annotations: GeminiAnnotation[] = [];
            for (const ra of rawAnnots) {
                const da = decodeGeminiAnnotation(ra, issues);
                if (!da) return null;
                annotations.push(da);
            }
            return {
                nodeType: GEMINI_NODE_TYPES.TEXT_BLOCK,
                text: payload[2],
                ...(jJ ? { jJ } : {}),
                ...(annotations.length ? { annotations } : {}),
            };
        }
        case GEMINI_WIRE_NODE_SLOTS.EXTENSION_OR_ATTACHMENT: {
            if (!isWireRecord(payload)) return null;
            if ('39' in payload) {
                const event = singleExtensionPayload(payload, '39');
                if (!isWireArray(event) || event.length !== 5 || typeof event[0] !== 'string'
                    || typeof event[1] !== 'string' || !/^[\w+-]+$/.test(event[1])
                    || !isPositiveSafeInt(event[2]) || event[3] !== null
                    || (event[4] !== 0 && event[4] !== 1)) return null;
                return {
                    nodeType: GEMINI_NODE_TYPES.CODE_BLOCK,
                    code: event[0],
                    info: `${event[1]}?${event[4] === 0 ? 'code_reference' : 'code_stdout'}&code_event_index=${event[2]}`,
                };
            }
            return { nodeType: GEMINI_NODE_TYPES.ATTACHMENT };
        }
        case GEMINI_WIRE_NODE_SLOTS.LEGACY_ATTACHMENT:
            return w.length >= 3 ? { nodeType: GEMINI_NODE_TYPES.ATTACHMENT } : null;
        default:
            return null;
    }
}

function unwrapRawNodeSequence(raw: unknown): unknown[] | null {
    if (!raw) return null;
    if (isWireRecord(raw)) return isWireArray(raw.children) ? raw.children : null;
    if (!isWireArray(raw)) return null;

    let nodeArray = raw;
    // Captured Imagen documents add an empty metadata trailer: [[[nodes]], []].
    if (nodeArray.length === 2 && isWireArray(nodeArray[1]) && nodeArray[1].length === 0
        && isWireArray(nodeArray[0]) && nodeArray[0].length === 1 && isWireArray(nodeArray[0][0])) {
        nodeArray = [nodeArray[0]];
    }
    if (nodeArray.length === 1 && isWireArray(nodeArray[0])) {
        const envelope = nodeArray[0];
        const layout = envelope[1];
        // The body sequence may carry a separate numeric rendering trailer.
        if (envelope.length === 2 && isWireArray(envelope[0])
            && isWireArray(layout) && layout.length === 5
            && layout.slice(0, 4).every(value => value === null)
            && isNonNegativeSafeInt(layout[4])) {
            nodeArray = envelope[0];
        } else if (nodeArray[0].length === 1 && isWireArray(nodeArray[0][0])) {
            nodeArray = nodeArray[0][0];
        } else if (nodeArray[0].length > 1 && isWireArray(nodeArray[0][0])) {
            nodeArray = nodeArray[0];
        }
    }
    return nodeArray;
}

export function decodeGeminiStructuredPayload(raw: unknown, issues?: DecodeIssues): GeminiStructuredDocument | null {
    const nodeArray = unwrapRawNodeSequence(raw);
    if (!nodeArray) return null;
    const children = decodeStructuredChildren(nodeArray, issues);
    return children ? { children } : null;
}

/** Extract top-level decoded/rejected block slots for a selected candidate when a valid
 * document sequence contains both decodable siblings and unsupported nodes. */
export function extractSelectedPartialSlots(turnDocument: unknown, candidateIndex = 0): GeminiPartialStructuredSlot[] | null {
    if (turnDocument == null || emptyDocumentPlaceholder(turnDocument)) return null;
    const selected = isWireArray(turnDocument) ? turnDocument[candidateIndex]
        : candidateIndex === 0 ? turnDocument : undefined;
    if (selected == null || emptyDocumentPlaceholder(selected)) return null;
    const nodeArray = unwrapRawNodeSequence(isWireArray(turnDocument) ? [selected] : selected);
    if (!nodeArray || nodeArray.length < 2) return null;
    const slots: GeminiPartialStructuredSlot[] = [];
    let hasDecoded = false;
    let hasRejected = false;
    for (const item of nodeArray) {
        const node = decodeGeminiStructuredNode(item);
        if (node) {
            slots.push({ kind: 'decoded', node });
            if (node.nodeType !== 'fragment' || node.children.length > 0) hasDecoded = true;
        } else {
            slots.push({ kind: 'rejected' });
            hasRejected = true;
        }
    }
    return hasDecoded && hasRejected ? slots : null;
}

export type GeminiStructuredExtraction =
    | { status: 'decoded'; document: GeminiStructuredDocument }
    | { status: 'missing' | 'candidate_unmatched' }
    | { status: 'decode_rejected'; issue: GeminiStructuredDecodeIssue; rawDocument?: JsonValue };

/** Find the rejected object by identity, keeping its original parent/wire positions. */
function rejectedValuePath(document: JsonValue, target: JsonValue, path = ''): string | undefined {
    if (document === target) return path;
    if (document === null || typeof document !== 'object') return undefined;
    for (const [key, value] of Object.entries(document)) {
        const found = rejectedValuePath(value, target, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
        if (found !== undefined) return found;
    }
    return undefined;
}

interface GeminiStructuredEvidenceInput {
    turnDocument: unknown;
    candidateIndex: number;
}

function emptyDocumentPlaceholder(value: unknown): boolean {
    return isWireArray(value) && value.every(emptyDocumentPlaceholder);
}

export function inspectStructuredContent(input: GeminiStructuredEvidenceInput): GeminiStructuredExtraction {
    // hNvQHb field 13 is a repeated document parallel to the candidate list.
    // Bind by the selected candidate's original index, as the provider decoder does.
    if (input.turnDocument == null || emptyDocumentPlaceholder(input.turnDocument)) return { status: 'missing' };
    const selected = isWireArray(input.turnDocument) ? input.turnDocument[input.candidateIndex]
        : input.candidateIndex === 0 ? input.turnDocument : undefined;
    if (selected === undefined) return { status: 'candidate_unmatched' };
    if (selected === null || emptyDocumentPlaceholder(selected)) return { status: 'missing' };
    const wrappedSelected = isWireArray(input.turnDocument) ? [selected] : selected;
    const issues: DecodeIssues = [];
    const document = decodeGeminiStructuredPayload(wrappedSelected, issues);
    const rawDocument = input.turnDocument;
    if (document) return { status: 'decoded', document };
    const issue = issues[0] ?? { kind: 'payload' };
    if (!isJsonValue(rawDocument)) return { status: 'decode_rejected', issue };
    if (!issues.length) { issue.rawValue = rawDocument; issue.path = ''; }
    else if (issue.rawValue !== null && typeof issue.rawValue === 'object') {
        issue.path = rejectedValuePath(rawDocument, issue.rawValue);
    }
    return { status: 'decode_rejected', issue, rawDocument };
}
