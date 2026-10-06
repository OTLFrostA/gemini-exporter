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

import type { BlockNode } from '../src/core/content/blocks.js';
const body = (text: string): BlockNode[] => text ? [{ type: 'paragraph', children: [{ type: 'text', text }] }] : [];

// The Domain boundary accepts provider-neutral roles only.
const domainRoles: DomainMessageRole[] = ['user', 'assistant', 'system'];
const domainMessage: DomainMessage = { role: 'assistant', content: body('Answer') };
// @ts-expect-error Gemini's model role must not cross the Domain boundary.
const rejectedDomainRole: DomainMessageRole = 'model';
// @ts-expect-error DomainMessage must use DomainMessageRole.
const rejectedDomainMessage: DomainMessage = { role: 'model', content: body('Answer') };
void domainRoles;
void domainMessage;
void rejectedDomainRole;
void rejectedDomainMessage;

const timestampedDomainMessage: DomainMessage = { role: 'user', content: body('Question'), timestamp: 1700000000123 };
// @ts-expect-error Unknown Domain message timestamps must be absent, never null.
const rejectedNullTimestamp: DomainMessage = { role: 'assistant', content: body('Answer'), timestamp: null };
void timestampedDomainMessage;
void rejectedNullTimestamp;

const provenanceDomainMessage: DomainMessage = { role: 'assistant', content: body('x'), provenance: { providerRequestId: 'abcd1234' } };
// @ts-expect-error Raw Gemini turn metadata is not part of DomainMessage.
const rejectedTurnId: DomainMessage = { role: 'assistant', content: body('x'), turnId: 'raw-turn' };
// @ts-expect-error Provider request identity belongs under provenance only.
const rejectedTopLevelRequestId: DomainMessage = { role: 'assistant', content: body('x'), providerRequestId: 'abcd1234' };
void provenanceDomainMessage;
void rejectedTurnId;
void rejectedTopLevelRequestId;

// @ts-expect-error Message-level provider generation evidence must be reconciled before Domain.
const rejectedMessageGeneration: DomainMessage = { role: 'assistant', content: body('x'), generation: { chatId: 'chat', generationOrdinal: 0 } };
void rejectedMessageGeneration;

const normalizedAliases: DomainMessage = {
    role: 'assistant', content: body('Answer'), reasoning: 'Provider reasoning',
    citations: [{ url: 'https://example.com', title: 'Example' }],
};
// @ts-expect-error Legacy thoughts must not cross the Domain boundary.
const rejectedThoughts: DomainMessage = { role: 'assistant', content: body(''), thoughts: 'Legacy' };
// @ts-expect-error Legacy thinking must not cross the Domain boundary.
const rejectedThinking: DomainMessage = { role: 'assistant', content: body(''), thinking: 'Legacy' };
// @ts-expect-error Raw sources must not cross the Domain boundary.
const rejectedSources: DomainMessage = { role: 'assistant', content: body(''), sources: ['https://example.com'] };
// @ts-expect-error Domain reasoning has one string representation.
const rejectedReasoningArray: DomainMessage = { role: 'assistant', content: body(''), reasoning: ['Legacy'] };
void normalizedAliases;
void rejectedThoughts;
void rejectedThinking;
void rejectedSources;
void rejectedReasoningArray;

// @ts-expect-error Raw Markdown is not a Domain body.
const rejectedRawBody: DomainMessage = { role: 'assistant', content: '**raw**' };
// @ts-expect-error Raw provider structure must be consumed before Domain.
const rejectedRawStructure: DomainMessage = { role: 'assistant', content: [], structuredContent: {} };
// @ts-expect-error C2's transitional body alias is gone.
const rejectedBodyAlias: DomainMessage = { role: 'assistant', content: [], contentAst: [] };
void rejectedRawBody;
void rejectedRawStructure;
void rejectedBodyAlias;
