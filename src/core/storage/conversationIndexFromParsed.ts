import type { ConversationParseResult } from '../parsers/contracts.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../domain/conversationIndex.js';
export type ConversationIngestionSource = 'detail' | 'takeout' | 'snapshot';

export function indexFromParsed(result: ConversationParseResult, source: ConversationIngestionSource = 'detail'): DomainConversationIndex {
    return restoreConversationIndex({ ...result.conversation.index,
        hasTakeoutImport: result.conversation.index.hasTakeoutImport || source === 'takeout',
        messageCount: result.conversation.detail.messages.length });
}
