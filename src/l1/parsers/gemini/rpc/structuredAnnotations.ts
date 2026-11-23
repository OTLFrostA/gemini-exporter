import { isJsonValue, type JsonValue } from '../../../../shared/utils/jsonTypes.js';
import { isGeminiSourceId } from './sourceAttributions.js';
import {
    GEMINI_ANNOTATION_TYPES,
    GEMINI_WIRE_STYLE_FLAGS,
    isExclusiveSlot,
    isHttpUrl,
    isHttpsUrl,
    isNonEmptyString,
    isNonNegativeSafeInt,
    isPositiveSafeInt,
    isWireArray,
    isWireRecord,
} from './jspbSchema.js';
import type {
    GeminiAnnotation,
    GeminiCitationReference,
    GeminiCitationSource,
    GeminiFileCitation,
} from './types.js';

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

export type DecodeIssues = GeminiStructuredDecodeIssue[];

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

export function citationTokens(marker: string): string[] | null {
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
