import type { ConversationRecordInput } from './record/conversationRecord.js';
import { parseConversationRecord, type ConversationRecordParseContext, type ConversationRecordParseResult } from './record/parseConversationRecord.js';
import { parseGeminiRpcConversation, type GeminiRpcParseContext, type GeminiRpcParseResult } from './gemini/rpcConversationParser.js';
import type { ResourceConversationParseResult } from './parsingResult.js';

export interface ConversationRecordParseInput extends ConversationRecordParseContext {
    format: 'conversation-record';
    data: ConversationRecordInput;
}
export interface GeminiRpcParseInput extends GeminiRpcParseContext {
    format: 'gemini-rpc';
    data: string;
}
/** Only formats with implemented Domain parsers belong here. */
export type ConversationParseInput = ConversationRecordParseInput | GeminiRpcParseInput;

export function parseConversation(input: ConversationRecordParseInput): ConversationRecordParseResult;
export function parseConversation(input: GeminiRpcParseInput): GeminiRpcParseResult;
export function parseConversation(input: ConversationParseInput): ResourceConversationParseResult;
/** Unified Domain entry; source-specific raw decoders never pass through conversation-record. */
export function parseConversation(input: ConversationParseInput): ResourceConversationParseResult {
    switch (input.format) {
        case 'conversation-record': return parseConversationRecord(input.data, input);
        case 'gemini-rpc': return parseGeminiRpcConversation(input.data, input);
        default: throw new TypeError(`Unsupported conversation format: ${String((input as { format?: unknown }).format)}`);
    }
}
