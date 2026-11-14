import type { Citation } from './extractors.js';
import { isHttpUrl } from './cardNodes.js';
import { validGeminiTextRange } from '../shared/sourceRanges.js';

/** Opaque identities are matched exactly, never translated across prefixes. */
export function isGeminiSourceId(value: unknown): value is string {
    return typeof value === 'string' && /^(?:(?:spp_|sp_|cit_)[\w-]+|0)$/.test(value);
}

function wireArray(value: unknown): value is unknown[] { return Array.isArray(value); }

/** Candidate-local source IDs; never search other candidates or turns for a match. */
export interface GeminiSourceAttribution {
    sourceId: string;
    sources: Citation[];
    /** Present only after both wire byte/UTF-16 ranges verify the selected Markdown. */
    quotedText?: string;
}

function verifiedQuote(header: unknown, markdown: string | undefined): string | undefined {
    if (markdown === undefined || !wireArray(header) || header.length !== 4 || typeof header[0] !== 'string'
        || !header[0] || header[1] != null || header[2] != null || !wireArray(header[3]) || header[3].length !== 2) return;
    const [bytes, text] = header[3];
    if (!wireArray(bytes) || bytes.length !== 2 || !wireArray(text) || text.length !== 2) return;
    const [start, end] = text, [byteStart, byteEnd] = bytes;
    if (typeof start !== 'number' || typeof end !== 'number' || typeof byteStart !== 'number' || typeof byteEnd !== 'number'
        || ![start, end, byteStart, byteEnd].every(value => Number.isSafeInteger(value) && value >= 0)) return;
    if (!validGeminiTextRange(markdown, start, end) || markdown.slice(start, end) !== header[0]) return;
    const encoder = new TextEncoder();
    if (encoder.encode(markdown.slice(0, start)).length !== byteStart
        || encoder.encode(markdown.slice(0, end)).length !== byteEnd) return;
    return header[0];
}

export function extractSourceAttributions(candidate: unknown, candidateText?: string): GeminiSourceAttribution[] {
    const metadata = wireArray(candidate) ? candidate[2] : undefined;
    const entries = wireArray(metadata) ? metadata[1] : undefined;
    if (!wireArray(entries)) return [];
    const byId = new Map<string, GeminiSourceAttribution>();
    const ambiguous = new Set<string>();
    const ambiguousQuotes = new Set<string>();
    for (const entry of entries) {
        if (!wireArray(entry) || !isGeminiSourceId(entry[3])) continue;
        const sourceId: string = entry[3];
        if (!wireArray(entry[2]) || !entry[2].length) { ambiguous.add(sourceId); continue; }
        const sources: Citation[] = [];
        for (const source of entry[2]) {
            if (!wireArray(source) || !isHttpUrl(source[0])
                || typeof source[1] !== 'string') { ambiguous.add(sourceId); break; }
            if (!sources.some(item => item.url === source[0])) sources.push({ url: source[0], title: source[1] });
        }
        const quotedText = verifiedQuote(entry[0], candidateText);
        const attribution: GeminiSourceAttribution = { sourceId, sources, ...(quotedText !== undefined ? { quotedText } : {}) };
        const existing = byId.get(sourceId);
        if (existing && JSON.stringify(existing.sources) !== JSON.stringify(sources)) ambiguous.add(sourceId);
        if (existing && existing.quotedText !== quotedText) ambiguousQuotes.add(sourceId);
        byId.set(sourceId, attribution);
    }
    return [...byId.values()].filter(entry => !ambiguous.has(entry.sourceId)).map(entry => {
        if (!ambiguousQuotes.has(entry.sourceId)) return entry;
        return { sourceId: entry.sourceId, sources: entry.sources };
    });
}
