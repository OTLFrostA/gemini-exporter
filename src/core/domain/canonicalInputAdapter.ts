import type { DomainMessage } from './conversationDetail.js';
import type { CanonicalMessageInput } from '../export/canonical/messageInput.js';
import type { Diagnostic } from '../export/canonical/diagnostics.js';
import { extractRawCitations } from '../export/canonical/gemini/normalizeCitations.js';
import { parseLegacyReasoning } from '../provider/gemini/contentAdapter.js';

/** Pass body semantics through unchanged; reasoning's existing string format is outside this migration. */
export function toCanonicalDomainMessage(message: DomainMessage, locator: string, providerId: string): CanonicalMessageInput {
    const { id, role, content, timestamp, attachments, images, documents, groundingCitationMarkers } = message;
    // A producer may expose a resolved document in attachments and retain its
    // metadata through the documents alias. Preserve one owned record, including
    // records without a URL/path that cannot be deduplicated by the asset resolver.
    const documentRecords = documents?.filter(document => !attachments?.includes(document));
    const diagnostics: Diagnostic[] = [];
    const context = { diagnostics, sourceRef: { providerId, ...(id !== undefined ? { providerMessageId: id } : {}), locator } };
    return {
        message: { id, role, content, timestamp, attachments, images, documents: documentRecords, groundingCitationMarkers },
        locator,
        reasoningBlocks: parseLegacyReasoning(message.reasoning, context),
        citationInput: extractRawCitations({ citations: message.citations }),
        diagnostics,
    };
}
