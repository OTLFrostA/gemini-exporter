import type { Account } from '../../l2/accountRegistry.js';
import { parseGeminiDomConversation, type GeminiDomRaw, type GeminiDomParseResult } from './gemini/dom/parseConversation.js';
import { parseGeminiTakeoutConversation, type GeminiTakeoutRaw, type GeminiTakeoutParseContext, type GeminiTakeoutParseResult } from './gemini/takeout/parseConversation.js';
import { parseGeminiRpcConversation, type GeminiRpcParseContext, type GeminiRpcParseResult } from './gemini/rpc/parseConversation.js';
import type { SourceConversationParseResult } from './parsingResult.js';

export interface GeminiRpcParseInput extends GeminiRpcParseContext {
    format: 'gemini-rpc';
    data: string;
}
export interface GeminiTakeoutParseInput extends GeminiTakeoutParseContext {
    format: 'gemini-takeout';
    data: GeminiTakeoutRaw;
}
export interface GeminiDomParseInput { account?: Account; format: 'gemini-dom'; providerId: 'gemini'; data: GeminiDomRaw }
/** Only formats with implemented Domain parsers belong here. */

export type ConversationParseInput = GeminiRpcParseInput | GeminiTakeoutParseInput | GeminiDomParseInput;

export function parseConversation(input: GeminiDomParseInput): GeminiDomParseResult;
export function parseConversation(input: GeminiRpcParseInput): GeminiRpcParseResult;
export function parseConversation(input: GeminiTakeoutParseInput): GeminiTakeoutParseResult;
export function parseConversation(input: ConversationParseInput): SourceConversationParseResult | Promise<SourceConversationParseResult>;
/** Pure source parsing; L1 submits the result to Domain admission. */
export function parseConversation(input: ConversationParseInput): SourceConversationParseResult | Promise<SourceConversationParseResult> {
    switch (input.format) {
        case 'gemini-dom': return parseGeminiDomConversation(input.data, input);
        case 'gemini-takeout': return parseGeminiTakeoutConversation(input.data, input);
        case 'gemini-rpc': return parseGeminiRpcConversation(input.data, input);
        default: throw new TypeError(`Unsupported conversation format: ${String((input as { format?: unknown }).format)}`);
    }
}
