import type { Conversation } from '../src/types/conversation.js';
import type { DomainConversationDetail, DomainMessage, DomainMessageRole } from '../src/core/domain/conversationDetail.js';
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

// The Domain boundary accepts provider-neutral roles only.
const domainRoles: DomainMessageRole[] = ['user', 'assistant', 'system'];
const domainMessage: DomainMessage = { role: 'assistant', content: 'Answer' };
// @ts-expect-error Gemini's model role must not cross the Domain boundary.
const rejectedDomainRole: DomainMessageRole = 'model';
// @ts-expect-error DomainMessage must use DomainMessageRole.
const rejectedDomainMessage: DomainMessage = { role: 'model', content: 'Answer' };
void domainRoles;
void domainMessage;
void rejectedDomainRole;
void rejectedDomainMessage;
