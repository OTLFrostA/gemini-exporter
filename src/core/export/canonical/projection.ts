import type { CanonicalConversationBundle, MessageNode } from './conversation.js';

export interface ProjectedView {
    messages: MessageNode[];
}

export function projectConversation(bundle: CanonicalConversationBundle): ProjectedView {
    return { messages: bundle.conversation.messages };
}
