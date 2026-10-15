import { parseConversationRecord, type ConversationRecordParseContext } from '../../src/core/parsers/legacyStorage/parseRecord.js';
import type { ConversationRecordInput } from '../../src/core/parsers/legacyStorage/conversationRecord.js';
/** Historical test evidence is parsed explicitly; production never accepts this input. */
export function historicalFixture(record: ConversationRecordInput, options: Partial<ConversationRecordParseContext> = {}) {
    return parseConversationRecord(record, { ...options, providerId: options.providerId ?? (record.source?.startsWith('openai') ? 'openai' : 'gemini') });
}
export function historicalFixtureDomain(record: ConversationRecordInput, options: Partial<ConversationRecordParseContext> = {}) {
    return historicalFixture(record, options).conversation;
}

import type { GeminiRpcParseResult } from '../../src/core/parsers/gemini/rpc/parseConversation.js';
/** A native runtime fixture with explicit transport evidence, never an application projection. */
export function rpcFixture<T extends ConversationRecordInput>(record: T, transport: Partial<GeminiRpcParseResult['transport']> = {}): GeminiRpcParseResult {
    return { ...historicalFixture(record), transport: { nextPageToken: null, ...transport } };
}
