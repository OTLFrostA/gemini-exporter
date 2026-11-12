import type { DomainCitation, DomainMessage } from '../../../../l2/conversationDetail.js';
import { linkCitationMarkers } from './citationAdapter.js';

/** Resolve raw textual markers before returning Domain, never inside a composer/backend. */
export function closeSourceCitations(message: DomainMessage, markers?: readonly string[],
    boundSources: ReadonlyMap<string, readonly DomainCitation[]> = new Map()): DomainMessage {
    const web = (message.citations ?? []).map(citation => ({ ...citation }));
    const citations: DomainCitation[] = [...web];
    const grounding = new Map<string, { citation: { id: string }; displayLabel: string }[]>();
    const normalize = (marker: string) => marker.toLowerCase().replace(/\s+/g, '');
    const nativeSources = new Map([...boundSources].map(([marker, sources]) => [normalize(marker), sources]));
    for (const raw of markers ?? []) {
        const marker = raw.trim();
        // A combined marker such as [cite:1,2] names one citation per number,
        // in order; duplicates within the marker collapse to a single entry.
        const sources = nativeSources.get(normalize(marker));
        const numbers = /^\[cite:\s*\d+(?:\s*,\s*\d+)*\]$/i.test(marker)
            ? [...new Set([...marker.matchAll(/\d+/g)].map(match => Number(match[0])))] : [];
        if (!sources && (!numbers.length || numbers.some(number => !Number.isSafeInteger(number)))) continue;
        const entries = sources ? sources.map(citation => {
            if (!citations.some(item => item.id === citation.id)) citations.push(citation);
            return { citation: { id: citation.id }, displayLabel: marker.replace(/^\[cite:\s*/i, '[') };
        }) : numbers.flatMap(number => {
            const id = `grounding-${number}`;
            return (boundSources.get(id) ?? [{ id }]).map(citation => {
                if (!citations.some(item => item.id === citation.id)) citations.push(citation);
                return { citation: { id: citation.id }, displayLabel: `[${number}]` };
            });
        });
        grounding.set(marker, entries);
        grounding.set(normalize(marker), entries);
    }
    linkCitationMarkers(message.content, web, grounding);
    if (message.reasoning) linkCitationMarkers(message.reasoning, web, grounding);
    return { ...message, ...(citations.length ? { citations } : {}) };
}
