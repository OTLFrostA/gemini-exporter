import type { DomainConversationWithDetail } from './conversation.js';

/** A source version proves saved body coverage only for a nonpartial capture. */
export function savedConversationVersion(conversation: DomainConversationWithDetail, sourceVersion?: number): number | undefined {
    return conversation.detail.completeness !== 'partial' && (conversation.detail.messages.length > 0 || conversation.detail.completeness === 'complete')
        ? sourceVersion : undefined;
}
