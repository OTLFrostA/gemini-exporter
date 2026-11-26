import type { Citation, GeminiSourceAttribution } from './types.js';
export type { GeminiSourceAttribution } from './types.js';
import { isHttpUrl } from './cardNodes.js';
import { validGeminiTextRange } from '../shared/sourceRanges.js';

/** Opaque identities are matched exactly, never translated across prefixes. */
export function isGeminiSourceId(value: unknown): value is string {
    return typeof value === 'string' && /^(?:(?:spp_|sp_|cit_)[\w-]+|0)$/.test(value);
}

function wireArray(value: unknown): value is unknown[] { return Array.isArray(value); }

/** A selected answer can carry an opened page without displaying a citation.
 * The observed response pairs this metadata with an unbound [0, 0] marker. */
export function hasUncitedPageMetadata(candidate: unknown[]): boolean {
    const metadata = candidate[2];
    if (!wireArray(metadata) || metadata.length !== 5 || metadata[1] != null
        || metadata[2] != null || metadata[3] != null) return false;
    const [records, , , , context] = metadata;
    if (!wireArray(records) || records.length !== 1 || !wireArray(context)
        || context.length !== 3 || context[0] != null || context[1] != null || context[2] !== 8) return false;
    const record = records[0];
    if (!wireArray(record) || record.length !== 4 || record[0] != null || record[1] != null || record[3] !== 3) return false;
    const descriptor = record[2];
    return wireArray(descriptor) && descriptor.length === 20 && isHttpUrl(descriptor[0])
        && descriptor.slice(1, 19).every(value => value == null)
        && typeof descriptor[19] === 'string' && Boolean(descriptor[19].trim()) && !isHttpUrl(descriptor[19]);
}

function verifiedQuote(header: unknown, markdown: string | undefined): GeminiSourceAttribution['quote'] {
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
    return { text: header[0], start, end };
}

export function extractSourceAttributions(candidate: unknown, candidateText?: string): GeminiSourceAttribution[] {
    const metadata = wireArray(candidate) ? candidate[2] : undefined;
    if (!wireArray(metadata)) return [];
    const entries = metadata[1];
    const byId = new Map<string, GeminiSourceAttribution>();
    const ambiguous = new Set<string>();
    const ambiguousQuotes = new Set<string>();
    for (const entry of wireArray(entries) ? entries : []) {
        if (!wireArray(entry) || !isGeminiSourceId(entry[3])) continue;
        const sourceId: string = entry[3];
        if (!wireArray(entry[2]) || !entry[2].length) { ambiguous.add(sourceId); continue; }
        const sources: Citation[] = [];
        for (const source of entry[2]) {
            if (!wireArray(source) || !isHttpUrl(source[0])
                || typeof source[1] !== 'string') { ambiguous.add(sourceId); break; }
            if (!sources.some(item => item.url === source[0])) sources.push({ url: source[0], title: source[1] });
        }
        const quote = verifiedQuote(entry[0], candidateText);
        const attribution: GeminiSourceAttribution = { sourceId, sources, ...(quote ? { quote } : {}) };
        const existing = byId.get(sourceId);
        if (existing && JSON.stringify(existing.sources) !== JSON.stringify(sources)) ambiguous.add(sourceId);
        if (existing && JSON.stringify(existing.quote) !== JSON.stringify(quote)) ambiguousQuotes.add(sourceId);
        byId.set(sourceId, attribution);
    }
    // Candidate-local direct citations use [byteStart, byteEnd, source, ...,
    // id] in metadata[0]. The source's slot 0 is the actual target; slot 20 is
    // a cache/attribution URL, not another source. These records establish an
    // identity binding but supply no dual-coordinate quote for range recovery.
    for (const entry of wireArray(metadata[0]) ? metadata[0] : []) {
        if (!wireArray(entry) || !isGeminiSourceId(entry[9])) continue;
        const sourceId = entry[9], descriptor = entry[2];
        if (entry.length !== 10 || typeof entry[0] !== 'number' || typeof entry[1] !== 'number'
            || !Number.isSafeInteger(entry[0]) || !Number.isSafeInteger(entry[1]) || entry[0] < 0 || entry[1] < entry[0]
            || !wireArray(descriptor) || !isHttpUrl(descriptor[0])) { ambiguous.add(sourceId); continue; }
        const url = descriptor[0];
        const existing = byId.get(sourceId);
        if (existing) {
            if (existing.sources.length !== 1 || existing.sources[0].url !== url) ambiguous.add(sourceId);
        } else byId.set(sourceId, { sourceId, sources: [{ url, title: url }] });
    }
    return [...byId.values()].filter(entry => !ambiguous.has(entry.sourceId)).map(entry => {
        if (!ambiguousQuotes.has(entry.sourceId)) return entry;
        return { sourceId: entry.sourceId, sources: entry.sources };
    });
}
