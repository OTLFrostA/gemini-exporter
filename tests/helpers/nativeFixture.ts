import { fixtureAccount } from './domainFixture.js';
import { parseConversationRecord, type ConversationRecordParseContext } from './recordFixture/parseRecord.js';
import type { ConversationRecordInput } from './recordFixture/conversationRecord.js';
/** Historical test evidence is parsed explicitly; production never accepts this input. */
export function historicalFixture(record: ConversationRecordInput, options: Partial<ConversationRecordParseContext> = {}) {
    return parseConversationRecord({ id: 'fixture-conversation', ...record }, { account: fixtureAccount(options.providerId ?? (record.source?.startsWith('openai') ? 'openai' : 'gemini')), ...options, providerId: options.providerId ?? (record.source?.startsWith('openai') ? 'openai' : 'gemini') });
}
export function historicalFixtureDomain(record: ConversationRecordInput, options: Partial<ConversationRecordParseContext> = {}) {
    return historicalFixture(record, options).conversation;
}

import { contentQuality } from '../../src/core/parsers/qualityEvidence.js';
import type { GeminiRpcParseResult } from '../../src/core/parsers/gemini/rpc/parseConversation.js';
/** A native runtime fixture with explicit transport evidence, never an application projection. */
export function rpcFixture<T extends ConversationRecordInput>(record: T, transport: Partial<GeminiRpcParseResult['transport']> & { turnsRejected?: number; schemaDrift?: string[] } = {}): GeminiRpcParseResult {
    const { turnsRejected, schemaDrift = [], ...acquisition } = transport;
    const parsed = historicalFixture(record);
    parsed.evidence = { ...parsed.evidence, ...(turnsRejected !== undefined ? { rejectedTurns: turnsRejected } : {}), ...(acquisition.nextPageToken ? { truncation: 'pagination_pending' } : {}) };
    parsed.conversation.detail.quality = contentQuality({ ...parsed.conversation.detail.quality, ...parsed.evidence,
        ...(acquisition.nextPageToken ? { truncation: 'pagination_pending' } : {}) });
    parsed.diagnostics.push(...schemaDrift.map(message => ({ severity: 'warning' as const, code: 'GEMINI_SCHEMA_DRIFT', message })));
    return {   ...parsed, transport: { nextPageToken: null, ...acquisition } };
}
