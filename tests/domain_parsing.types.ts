import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { parseGeminiTakeoutConversation, type GeminiTakeoutRaw, type GeminiTakeoutParseResult } from '../src/core/parsers/gemini/takeout/parseConversation.js';
import { parseGeminiTakeoutZip, type GeminiTakeoutZipRaw } from '../src/core/parsers/gemini/takeout/parseZip.js';
import type { ConversationParser, ConversationParseResult } from '../src/core/parsers/contracts.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { parseConversationRecord } from '../src/core/parsers/legacyStorage/parseRecord.js';
import { parseGeminiRpcConversation, type GeminiRpcParseResult } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import type { ConversationRecordInput } from '../src/core/parsers/legacyStorage/conversationRecord.js';

// Raw decoders need no legacy Conversation, export hints, storage schema or Gemini input type.
const syncRawParser: ConversationParser<{ text: string }> = (raw, context) => ({
    conversation: validateParserDomain({ providerId: context.providerId, id: '', title: '', completeness: 'unknown', assets: [],
        messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: raw.text }] }] }] }),
    diagnostics: [],
});
const asyncRawParser: ConversationParser<{ text: string }> = async (raw, context) => syncRawParser(raw, context);
const recordParser: ConversationParser<ConversationRecordInput> = parseConversationRecord;
const sharedResult: ConversationParseResult = historicalFixture({}, { providerId: 'provider' });
void asyncRawParser;
void recordParser;
void sharedResult;
const rpcParser: ConversationParser<string, GeminiRpcParseResult> = parseGeminiRpcConversation;
const rpcResult: GeminiRpcParseResult = parseConversation({ format: 'gemini-rpc', providerId: 'gemini', data: '[]' });
const cursor: string | null = rpcResult.transport.nextPageToken;
void rpcParser;
void cursor;

// @ts-expect-error Every new entry point requires an explicit provider.
parseConversation({ format: 'gemini-rpc', data: '[]' });
// @ts-expect-error Raw RPC parsing requires response text rather than a record.
parseConversation({ format: 'gemini-rpc', providerId: 'gemini', data: {} });
// Build every negative type case from a valid Domain baseline, so @ts-expect-error
// cannot be satisfied by an unrelated missing required field or stale timestamp alias.
const validDomain: DomainConversationDetail = {
    providerId: 'provider', id: 'typed', title: 'Typed conversation',
    completeness: 'unknown', assets: [], messages: [],
};
const diagnosticsInDomain: DomainConversationDetail = {
    ...validDomain,
    // @ts-expect-error Problems remain outside the semantic conversation.
    diagnostics: [],
};
const cursorInDomain: DomainConversationDetail = {
    ...validDomain,
    // @ts-expect-error Cursors are acquisition context, not permanent conversation facts.
    nextPageToken: 'cursor',
};
const invalidCoverage: DomainConversationDetail = {
    ...validDomain,
    // @ts-expect-error Completeness has a closed vocabulary independent of any provider status.
    completeness: { status: 'finished' },
};
void validDomain;
void diagnosticsInDomain;
void cursorInDomain;
void invalidCoverage;

const takeoutParser: ConversationParser<GeminiTakeoutRaw, GeminiTakeoutParseResult> = parseGeminiTakeoutConversation;
const zipParser: ConversationParser<GeminiTakeoutZipRaw, GeminiTakeoutParseResult> = parseGeminiTakeoutZip;
const zipResult: Promise<GeminiTakeoutParseResult> = parseConversation({ format: 'gemini-takeout-zip', providerId: 'gemini', data: new Uint8Array() });
// @ts-expect-error ZIP input is raw bytes rather than decoded HTML or a persisted record.
parseConversation({ format: 'gemini-takeout-zip', providerId: 'gemini', data: '<html></html>' });
void takeoutParser;
void zipParser;
void zipResult;
