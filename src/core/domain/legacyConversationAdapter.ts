import type { Conversation } from '../../types/conversation.js';
import type { DomainConversationDetail } from './conversationDetail.js';
import type { LegacyResourceHints } from '../export/assets/resourceHints.js';
import { inferLegacyProviderId, type LegacyDomainConstructionOptions } from '../provider/conversationParser.js';
import { parseConversation } from '../provider/parseConversation.js';
export type { LegacyDomainConstructionOptions } from '../provider/conversationParser.js';

/** Strict application input contract; provider exports can preserve unknown raw bodies through parseProviderConversation. */
export function parseLegacyConversation(conversation: Conversation, options: LegacyDomainConstructionOptions = {}): { conversation: DomainConversationDetail; resourceHints: LegacyResourceHints } {
    const messages = conversation.messages?.length ? conversation.messages : conversation.turns?.flatMap(turn => turn.messages ?? []) ?? [];
    if (messages.some(message => typeof message.content !== 'string') || (!conversation.messages?.length && conversation.turns?.some(turn =>
        !turn.messages?.length && ((turn.userContent !== undefined && typeof turn.userContent !== 'string') || (turn.modelContent !== undefined && typeof turn.modelContent !== 'string'))))) {
        throw new TypeError('Legacy message content must be a string');
    }
    const { conversation: domain, resourceHints } = parseConversation({ format: 'conversation-record', data: conversation, providerId: options.providerId ?? inferLegacyProviderId(conversation), generatedMedia: options.generatedMedia });
    return { conversation: domain, resourceHints };
}

/** Pure semantic result; callers needing export destinations use the parser's separate resource hints. */
export function toDomainConversationDetail(conversation: Conversation, options: LegacyDomainConstructionOptions = {}): DomainConversationDetail {
    return parseLegacyConversation(conversation, options).conversation;
}
