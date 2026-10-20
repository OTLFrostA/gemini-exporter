import type { DeepReadonly } from './readonly.js';
import type { DomainConversationWithDetail } from './conversation.js';

/** Source snapshot version is independent of completeness and message count. */
export function savedConversationVersion(conversation: DeepReadonly<DomainConversationWithDetail>, sourceVersion?: number): number | undefined {
    return conversation.detail.savedAt ?? sourceVersion;
}
