import type { Conversation } from '../src/types/conversation.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { toDomainConversationDetail } from '../src/core/domain/legacyConversationAdapter.js';

const legacyConversation: Conversation = {
    id: 'typed-conversation',
    title: 'Typed fixture',
    timestamp: null,
    messages: [{ role: 'assistant', content: 'Typed message', timestamp: null }],
};

const domainConversation: DomainConversationDetail = toDomainConversationDetail(legacyConversation);

// These assignments make both adapter boundaries part of strict TypeScript checking.
const acceptedLegacyInput: Conversation = legacyConversation;
const typedDomainResult: DomainConversationDetail = domainConversation;
void acceptedLegacyInput;
void typedDomainResult;
