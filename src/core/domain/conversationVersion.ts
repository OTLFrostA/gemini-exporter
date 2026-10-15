import type { DeepReadonly } from './readonly.js';
import type { DomainConversationWithDetail } from './conversation.js';

/** A source version proves saved body coverage only for a nonpartial capture. */
export function savedConversationVersion(conversation: DeepReadonly<DomainConversationWithDetail>, sourceVersion?: number): number | undefined {
    return conversation.detail.completeness !== 'partial' && (conversation.detail.messages.length > 0 || conversation.detail.completeness === 'complete')
        ? sourceVersion : undefined;
}
