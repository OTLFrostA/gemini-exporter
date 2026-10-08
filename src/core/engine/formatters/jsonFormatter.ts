import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { assertDomainClosure } from '../../domain/closure.js';
import { projectDomainRecord } from '../../compatibility/record/projectDomainRecord.js';

/** The historical string projection exists only at the external serialization boundary. */
export function toOpenAIJson(result: ResourceConversationParseResult): string {
    const domain = result.conversation;
    assertDomainClosure(domain);
    const paths = Object.fromEntries(Object.entries(result.resourceHints).flatMap(([id, hint]) => hint.archivePath ? [[id, hint.archivePath]] : []));
    const record = projectDomainRecord(domain, paths, result.acquisitionHints);
    const messages = (record.messages ?? []).map((message, index) => {
        const source = domain.messages[index];
        const images = (message.attachments ?? []).filter(asset => asset.type === 'image');
        const content = images.length ? [
            ...(message.content ? [{ type: 'text', text: message.content }] : []),
            ...images.map(asset => ({ type: 'image_url', image_url: { url: asset.localName || asset.src || asset.url || '' } }))
        ] : message.content;
        return { role: source.role === 'unknown' ? 'user' : source.role, content,
            ...(source.role === 'unknown' ? { original_role: source.provenance?.rawRole ?? 'unknown' } : {}),
            ...(message.thoughts ? { reasoning_content: message.thoughts } : {}) };
    });
    return JSON.stringify({ id: domain.id, title: domain.title, url: domain.url ?? domain.href,
        ...(domain.createdAt !== null && domain.createdAt !== undefined ? { created_at: new Date(domain.createdAt).toISOString() } : {}), messages }, null, 2);
}

/** A versioned semantic archive, independent of storage and transport implementations. */
export function toJsonStandard(result: ResourceConversationParseResult): string {
    assertDomainClosure(result.conversation);
    const resources = Object.fromEntries(Object.entries(result.resourceHints).flatMap(([id, hint]) => hint.archivePath ? [[id, { path: hint.archivePath }]] : []));
    return JSON.stringify({ format: 'gemini-exporter-domain', version: 1, conversation: result.conversation,
        ...(Object.keys(resources).length ? { resources } : {}) }, null, 2);
}

/** Developer-only evidence export; missing raw evidence must not masquerade as provider data. */
export function toJsonRaw(result: ResourceConversationParseResult): string {
    const transport = 'transport' in result ? result.transport : undefined;
    if (!transport || typeof transport !== 'object' || !('decodedPayload' in transport) || transport.decodedPayload === undefined) {
        throw new Error('Raw provider evidence is unavailable for this conversation');
    }
    return JSON.stringify(transport.decodedPayload, null, 2);
}
