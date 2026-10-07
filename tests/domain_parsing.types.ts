import type { ConversationParser, ConversationParseResult } from '../src/core/domain/parsing.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { parseConversation } from '../src/core/provider/parseConversation.js';
import { parseConversationRecord } from '../src/core/provider/record/parseConversationRecord.js';
import { parseGeminiRpcConversation, type GeminiRpcParseResult } from '../src/core/provider/gemini/rpcConversationParser.js';
import type { ConversationRecordInput } from '../src/core/provider/record/conversationRecord.js';

// Raw decoders need no legacy Conversation, export hints, storage schema or Gemini input type.
const syncRawParser: ConversationParser<{ text: string }> = (raw, context) => ({
    conversation: { providerId: context.providerId, id: '', title: '', timestamp: null, assets: [],
        messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: raw.text }] }] }] },
    diagnostics: [],
});
const asyncRawParser: ConversationParser<{ text: string }> = async (raw, context) => syncRawParser(raw, context);
const recordParser: ConversationParser<ConversationRecordInput> = parseConversationRecord;
const sharedResult: ConversationParseResult = parseConversation({ format: 'conversation-record', providerId: 'provider', data: {} });
void asyncRawParser;
void recordParser;
void sharedResult;
const rpcParser: ConversationParser<string, GeminiRpcParseResult> = parseGeminiRpcConversation;
const rpcResult: GeminiRpcParseResult = parseConversation({ format: 'gemini-rpc', providerId: 'gemini', data: '[]' });
const cursor: string | null = rpcResult.transport.nextPageToken;
void rpcParser;
void cursor;

// @ts-expect-error Every new entry point requires an explicit provider.
parseConversation({ format: 'conversation-record', data: {} });
// @ts-expect-error Raw RPC parsing requires response text rather than a record.
parseConversation({ format: 'gemini-rpc', providerId: 'gemini', data: {} });
// @ts-expect-error Problems remain outside the semantic conversation.
const diagnosticsInDomain: DomainConversationDetail = { providerId: 'provider', id: '', title: '', timestamp: null, assets: [], messages: [], diagnostics: [] };
// @ts-expect-error Cursors are acquisition context, not permanent conversation facts.
const cursorInDomain: DomainConversationDetail = { providerId: 'provider', id: '', title: '', timestamp: null, assets: [], messages: [], nextPageToken: 'cursor' };
// @ts-expect-error Completeness has a closed vocabulary independent of any provider status.
const invalidCoverage: DomainConversationDetail = { providerId: 'provider', id: '', title: '', timestamp: null, assets: [], messages: [], completeness: { status: 'finished' } };
void diagnosticsInDomain;
void cursorInDomain;
void invalidCoverage;
