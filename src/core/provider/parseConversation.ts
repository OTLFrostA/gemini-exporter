import type { ConversationRecordInput } from './record/conversationRecord.js';
import { parseConversationRecord, type ConversationRecordParseContext, type ConversationRecordParseResult } from './record/parseConversationRecord.js';

/** Only formats with implemented Domain parsers belong here. Add raw formats as they migrate. */
export interface ConversationParseInput extends ConversationRecordParseContext {
    format: 'conversation-record';
    data: ConversationRecordInput;
}

/** Unified Domain entry; conversation-record is an explicit migration bridge, not a raw decoder. */
export function parseConversation(input: ConversationParseInput): ConversationRecordParseResult {
    switch (input.format) {
        case 'conversation-record': return parseConversationRecord(input.data, input);
        default: throw new TypeError(`Unsupported conversation format: ${String(input.format)}`);
    }
}
