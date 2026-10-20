import type { ConversationParser } from '../src/core/parsers/contracts.js';
import type { SourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
import type { TrustedDomain } from '../src/core/domain/runtimeValidation.js';
import { parseConversation } from '../src/core/parsers/parseConversation.js';
import { parseGeminiRpcConversation, type GeminiRpcParseResult } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { parseGeminiTakeoutConversation, type GeminiTakeoutRaw, type GeminiTakeoutParseResult } from '../src/core/parsers/gemini/takeout/parseConversation.js';
import { parseGeminiTakeoutZip, type GeminiTakeoutZipRaw } from '../src/core/imports/takeout/readArchive.js';
// @ts-expect-error The old trusted Parser contract is not a public L1 API.
import type { ConversationParseResult } from '../src/core/parsers/contracts.js';
// @ts-expect-error The old resource/Domain output is not a public L1 API.
import type { ResourceConversationParseResult } from '../src/core/parsers/parsingResult.js';
// @ts-expect-error The barrel must not re-export the old contract.
import type { ConversationParseResult as BarrelLegacyResult } from '../src/core/parsers/index.js';

const rawParser: ConversationParser<{ text: string }> = raw => ({ conversationId: 'source',
    conversation: { index: {}, detail: { quality: { status: 'unknown' }, assets: [], messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: raw.text }] }] }] } },
    diagnostics: [], acquisitionHints: {} });
const asyncParser: ConversationParser<{ text: string }> = async (raw, context) => rawParser(raw, context);
const rpcParser: ConversationParser<string, GeminiRpcParseResult> = parseGeminiRpcConversation;
const takeoutParser: ConversationParser<GeminiTakeoutRaw, GeminiTakeoutParseResult> = parseGeminiTakeoutConversation;
const zipReader: ConversationParser<GeminiTakeoutZipRaw, GeminiTakeoutParseResult> = parseGeminiTakeoutZip;
function sourceContract(result: SourceConversationParseResult) {
    // @ts-expect-error Export destinations belong to a delivery task, not the L1 parser result.
    result.resourceHints;
    // @ts-expect-error L1 output has no local Account.
    result.account;
    // @ts-expect-error Local identity binding belongs to L2.
    result.conversation.index.key;
    // @ts-expect-error Detail has no local identity before L2 admission.
    result.conversation.detail.key;
    // @ts-expect-error Unadmitted Parser output is not trusted Domain.
    const trusted: TrustedDomain = result.conversation;
    void trusted;
}
// @ts-expect-error Provider is required.
parseConversation({ format: 'gemini-rpc', data: '[]' });
// @ts-expect-error RPC expects raw text.
parseConversation({ format: 'gemini-rpc', providerId: 'gemini', data: {} });
// @ts-expect-error ZIP IO belongs to Import, not the pure Parser dispatcher.
parseConversation({ format: 'gemini-takeout-zip', providerId: 'gemini', data: new Uint8Array() });
void [asyncParser, rpcParser, takeoutParser, zipReader, sourceContract];
