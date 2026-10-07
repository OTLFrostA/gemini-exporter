import { parseGeminiTakeoutZip, type GeminiTakeoutZipRaw, type GeminiTakeoutZipContext } from './gemini/takeout/parseZip.js';
import { parseGeminiTakeoutConversation, type GeminiTakeoutRaw, type GeminiTakeoutParseContext, type GeminiTakeoutParseResult } from './gemini/takeout/parseConversation.js';
import type { ConversationRecordInput } from '../compatibility/record/conversationRecord.js';
import { parseConversationRecord, type ConversationRecordParseContext, type ConversationRecordParseResult } from '../compatibility/record/parseConversationRecord.js';
import { parseGeminiRpcConversation, type GeminiRpcParseContext, type GeminiRpcParseResult } from './gemini/rpc/parseConversation.js';
import type { ResourceConversationParseResult } from './parsingResult.js';

export interface ConversationRecordParseInput extends ConversationRecordParseContext {
    format: 'conversation-record';
    data: ConversationRecordInput;
}
export interface GeminiRpcParseInput extends GeminiRpcParseContext {
    format: 'gemini-rpc';
    data: string;
}
export interface GeminiTakeoutParseInput extends GeminiTakeoutParseContext {
    format: 'gemini-takeout';
    data: GeminiTakeoutRaw;
}
export interface GeminiTakeoutZipParseInput extends GeminiTakeoutZipContext {
    format: 'gemini-takeout-zip';
    data: GeminiTakeoutZipRaw;
}
/** Only formats with implemented Domain parsers belong here. */
export type ConversationParseInput = ConversationRecordParseInput | GeminiRpcParseInput | GeminiTakeoutParseInput | GeminiTakeoutZipParseInput;

export function parseConversation(input: ConversationRecordParseInput): ConversationRecordParseResult;
export function parseConversation(input: GeminiRpcParseInput): GeminiRpcParseResult;
export function parseConversation(input: GeminiTakeoutParseInput): GeminiTakeoutParseResult;
export function parseConversation(input: GeminiTakeoutZipParseInput): Promise<GeminiTakeoutParseResult>;
export function parseConversation(input: ConversationParseInput): ResourceConversationParseResult | Promise<ResourceConversationParseResult>;
/** Unified Domain entry; source-specific raw decoders never pass through conversation-record. */
export function parseConversation(input: ConversationParseInput): ResourceConversationParseResult | Promise<ResourceConversationParseResult> {
    switch (input.format) {
        case 'conversation-record': return parseConversationRecord(input.data, input);
        case 'gemini-takeout-zip': return parseGeminiTakeoutZip(input.data, input);
        case 'gemini-takeout': return parseGeminiTakeoutConversation(input.data, input);
        case 'gemini-rpc': return parseGeminiRpcConversation(input.data, input);
        default: throw new TypeError(`Unsupported conversation format: ${String((input as { format?: unknown }).format)}`);
    }
}
