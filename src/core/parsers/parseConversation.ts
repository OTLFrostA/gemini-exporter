import { parseLegacyStorageConversation, type LegacyStorageRaw } from './legacyStorage/parseConversation.js';
import { parseGeminiDomConversation, type GeminiDomRaw, type GeminiDomParseResult } from './gemini/dom/parseConversation.js';
import { parseGeminiTakeoutZip, type GeminiTakeoutZipRaw, type GeminiTakeoutZipContext } from './gemini/takeout/parseZip.js';
import { parseGeminiTakeoutConversation, type GeminiTakeoutRaw, type GeminiTakeoutParseContext, type GeminiTakeoutParseResult } from './gemini/takeout/parseConversation.js';
import { parseGeminiRpcConversation, type GeminiRpcParseContext, type GeminiRpcParseResult } from './gemini/rpc/parseConversation.js';
import type { ResourceConversationParseResult } from './parsingResult.js';

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
export interface GeminiDomParseInput { format: 'gemini-dom'; providerId: 'gemini'; data: GeminiDomRaw }
/** Only formats with implemented Domain parsers belong here. */
export interface LegacyStorageParseInput { format: 'legacy-storage'; providerId: string; data: LegacyStorageRaw }
export type ConversationParseInput = LegacyStorageParseInput | GeminiRpcParseInput | GeminiTakeoutParseInput | GeminiTakeoutZipParseInput | GeminiDomParseInput;

export function parseConversation(input: LegacyStorageParseInput): ResourceConversationParseResult;
export function parseConversation(input: GeminiDomParseInput): GeminiDomParseResult;
export function parseConversation(input: GeminiRpcParseInput): GeminiRpcParseResult;
export function parseConversation(input: GeminiTakeoutParseInput): GeminiTakeoutParseResult;
export function parseConversation(input: GeminiTakeoutZipParseInput): Promise<GeminiTakeoutParseResult>;
export function parseConversation(input: ConversationParseInput): ResourceConversationParseResult | Promise<ResourceConversationParseResult>;
/** Unified Domain entry; historical disk records use only the migration format. */
export function parseConversation(input: ConversationParseInput): ResourceConversationParseResult | Promise<ResourceConversationParseResult> {
    switch (input.format) {
        case 'legacy-storage': return parseLegacyStorageConversation(input.data, input);
        case 'gemini-dom': return parseGeminiDomConversation(input.data, input);
        case 'gemini-takeout-zip': return parseGeminiTakeoutZip(input.data, input);
        case 'gemini-takeout': return parseGeminiTakeoutConversation(input.data, input);
        case 'gemini-rpc': return parseGeminiRpcConversation(input.data, input);
        default: throw new TypeError(`Unsupported conversation format: ${String((input as { format?: unknown }).format)}`);
    }
}
