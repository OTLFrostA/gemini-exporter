import type { DomainCitation, DomainMessage } from '../domain/conversationDetail.js';
import { linkCitationMarkers } from './citationAdapter.js';

/** Resolve raw textual markers before returning Domain, never inside a composer/backend. */
export function closeLegacyCitations(message: DomainMessage, markers?: readonly string[]): DomainMessage {
    const web = (message.citations ?? []).map(citation => ({ ...citation }));
    const citations: DomainCitation[] = [...web];
    const grounding = new Map<string, { citation: { id: string }; displayLabel: string }>();
    for (const raw of markers ?? []) {
        if (typeof raw !== 'string') continue;
        const marker = raw.trim();
        const number = Number(marker.match(/\d+/)?.[0] ?? 1);
        if (!Number.isSafeInteger(number)) continue;
        const id = `grounding-${number}`;
        if (!citations.some(citation => citation.id === id)) citations.push({ id, kind: 'attachment', number });
        const entry = { citation: { id }, displayLabel: `[${number}]` };
        grounding.set(marker, entry);
        grounding.set(marker.toLowerCase().replace(/\s+/g, ' '), entry);
    }
    linkCitationMarkers(message.content, web, grounding);
    if (message.reasoning) linkCitationMarkers(message.reasoning, web, grounding);
    return { ...message, ...(citations.length ? { citations } : {}) };
}
