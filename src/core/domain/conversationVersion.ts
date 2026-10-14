import type { DomainConversationDetail } from './conversationDetail.js';

/** A source version proves saved body coverage only for a nonpartial capture. */
export function savedConversationVersion(conversation: DomainConversationDetail, sourceVersion?: number): number | undefined {
    return conversation.completeness !== 'partial' && (conversation.messages.length > 0 || conversation.completeness === 'complete')
        ? sourceVersion : undefined;
}
