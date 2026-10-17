import { fixtureAccount, fixtureKey } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { historicalFixture } from './helpers/nativeFixture.js';
import { parseGeminiTakeoutConversation, type GeminiTakeoutRaw, type GeminiTakeoutParseResult } from '../src/core/parsers/gemini/takeout/parseConversation.js';
import { parseGeminiTakeoutZip, type GeminiTakeoutZipRaw } from '../src/core/parsers/gemini/takeout/parseZip.js';
import type { ConversationParser, ConversationParseResult } from '../src/core/parsers/contracts.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { parseConversationRecord } from './helpers/recordFixture/parseRecord.js';
import { parseGeminiRpcConversation, type GeminiRpcParseResult } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import type { ConversationRecordInput } from './helpers/recordFixture/conversationRecord.js';

// Raw decoders need no legacy Conversation, export hints, storage schema or Gemini input type.
const syncRawParser: ConversationParser<{ text: string }> = (raw, context) => ({ account: fixtureAccount(),
    conversation: validateParserDomain({ index: { key: fixtureKey(String(''), context.providerId),   titleSource: "derived",   title: '' }, detail: { key: fixtureKey(String(''), context.providerId), quality: { status: 'unknown' }, assets: [], messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: raw.text }] }] }] } }),
    diagnostics: [],
});
const asyncRawParser: ConversationParser<{ text: string }> = async (raw, context) => syncRawParser(raw, context);
const recordParser: ConversationParser<ConversationRecordInput> = parseConversationRecord;
const sharedResult: ConversationParseResult = historicalFixture({}, { providerId: 'provider' });
void asyncRawParser;
void recordParser;
void sharedResult;
const rpcParser: ConversationParser<string, GeminiRpcParseResult> = parseGeminiRpcConversation;
const rpcResult: GeminiRpcParseResult = parseConversation({ account: fixtureAccount('gemini'), format: 'gemini-rpc', providerId: 'gemini', data: '[]' });
const cursor: string | null = rpcResult.transport.nextPageToken;
void rpcParser;
void cursor;

// @ts-expect-error Every new entry point requires an explicit provider.
parseConversation({ account: fixtureAccount(), format: 'gemini-rpc', data: '[]' });
// @ts-expect-error Raw RPC parsing requires response text rather than a record.
parseConversation({ account: fixtureAccount('gemini'), format: 'gemini-rpc', providerId: 'gemini', data: {} });
// Build every negative type case from a valid Domain baseline, so @ts-expect-error
// cannot be satisfied by an unrelated missing required field or stale timestamp alias.
const validDomain: DomainConversationWithDetail = { index: { key: fixtureKey(String('typed'), 'provider'),   titleSource: "derived",   title: 'Typed conversation' }, detail: { key: fixtureKey(String('typed'), 'provider'), quality: { status: 'unknown' }, assets: [], messages: [] } };
// @ts-expect-error Invalid semantic envelope field.
const diagnosticsInDomain: DomainConversationWithDetail = { index: { ...validDomain.index }, detail: { key: validDomain.index.key,  ...validDomain.detail }, diagnostics: [] };
// @ts-expect-error Invalid semantic envelope field.
const cursorInDomain: DomainConversationWithDetail = { index: { ...validDomain.index }, detail: { key: validDomain.index.key,  ...validDomain.detail }, nextPageToken: 'cursor' };
// @ts-expect-error Invalid semantic envelope field.
const invalidCoverage: DomainConversationWithDetail = { index: { ...validDomain.index }, detail: { key: validDomain.index.key,  ...validDomain.detail, quality: { status: 'finished' } } };
void validDomain;
void diagnosticsInDomain;
void cursorInDomain;
void invalidCoverage;

const takeoutParser: ConversationParser<GeminiTakeoutRaw, GeminiTakeoutParseResult> = parseGeminiTakeoutConversation;
const zipParser: ConversationParser<GeminiTakeoutZipRaw, GeminiTakeoutParseResult> = parseGeminiTakeoutZip;
const zipResult: Promise<GeminiTakeoutParseResult> = parseConversation({ account: fixtureAccount('gemini'), format: 'gemini-takeout-zip', providerId: 'gemini', data: new Uint8Array() });
// @ts-expect-error ZIP input is raw bytes rather than decoded HTML or a persisted record.
parseConversation({ account: fixtureAccount('gemini'), format: 'gemini-takeout-zip', providerId: 'gemini', data: '<html></html>' });
void takeoutParser;
void zipParser;
void zipResult;
