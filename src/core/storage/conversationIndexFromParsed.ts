import type { ConversationParseResult } from '../parsers/contracts.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../domain/conversationIndex.js';
export type ConversationIngestionSource = 'detail' | 'takeout' | 'snapshot';
export function indexFromParsed(result: ConversationParseResult, _source: ConversationIngestionSource = 'detail'): DomainConversationIndex { return restoreConversationIndex(result.conversation.index); }
