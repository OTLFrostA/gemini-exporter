import { parseConversationRecord, type ConversationRecordParseContext } from '../../src/core/compatibility/record/parseConversationRecord.js';
import { inferLegacyProviderId } from '../../src/core/compatibility/record/legacyProvider.js';
import type { ConversationRecordInput } from '../../src/core/compatibility/record/conversationRecord.js';
/** Historical test evidence is parsed explicitly; production never accepts this input. */
export function historicalFixture(record: ConversationRecordInput, options: Partial<ConversationRecordParseContext> = {}) {
    return parseConversationRecord(record, { ...options, providerId: options.providerId ?? inferLegacyProviderId(record) });
}
export function historicalFixtureDomain(record: ConversationRecordInput, options: Partial<ConversationRecordParseContext> = {}) {
    return historicalFixture(record, options).conversation;
}

import type { GeminiRpcParseResult } from '../../src/core/parsers/gemini/rpc/parseConversation.js';
/** A native runtime fixture with explicit transport evidence, never an application projection. */
export function rpcFixture<T extends ConversationRecordInput>(record: T, transport: Partial<GeminiRpcParseResult['transport']> = {}): GeminiRpcParseResult {
    return { ...historicalFixture(record), transport: { nextPageToken: null, ...transport } };
}
