import { readParsedConversation } from '../compatibility/record/projectDomainRecord.js';
import type { ResourceConversationParseResult } from '../parsers/parsingResult.js';
import type { Conversation } from '../../types/conversation.js';
import { parseLegacyConversation } from '../compatibility/legacyConversationAdapter.js';
import { exportDomainHtml, exportDomainMarkdown, type DomainHtmlExportOptions, type DomainMarkdownExportOptions } from '../export/exportDomainDocument.js';
import { convertHtmlToMarkdown } from "../parsers/shared/html/htmlToMarkdown.js";
import {
    toOpenAIJson,
    toJsonStandard,
    toJsonRaw
} from "./formatters/jsonFormatter.js";

export interface FormattedResult {
    content: string;
    ext: string;
    mime: string;
}

export interface ChatFormatterModule {
    convertHtmlToMarkdown: (html?: string | null) => string;
    toOpenAIJson: (chat: any) => string;
    formatContent: (chat: any, formatType: string) => FormattedResult;
    formatMarkdownDocument: (chat: any, opts?: DomainMarkdownExportOptions) => Promise<FormattedResult>;
    formatHtmlDocument: (chat: any, opts?: DomainHtmlExportOptions) => Promise<FormattedResult>;
}

export type ChatExportInput = Omit<Conversation, 'timestamp'> & { timestamp?: number | null };

function parsedForExport(chat: ChatExportInput): ResourceConversationParseResult {
    const native = readParsedConversation(chat);
    if (native) return { ...native, conversation: { ...native.conversation, id: chat.id, title: chat.title,
        ...(chat.titleSource ? { titleSource: chat.titleSource } : {}), ...(chat.titles ? { titles: { ...chat.titles } } : {}) } };
    // Existing stored records remain readable until the independent storage migration.
    const parsed = parseLegacyConversation({ ...chat, timestamp: chat.timestamp ?? null });
    return { ...parsed, diagnostics: [], acquisitionHints: {} };
}

export async function formatHtmlDocument(chat: ChatExportInput, opts: DomainHtmlExportOptions = {}): Promise<FormattedResult> {
    const { conversation, resourceHints } = parsedForExport(chat);
    return { content: await exportDomainHtml(conversation, { ...opts, resourceHints }), ext: 'html', mime: 'text/html' };
}

export async function formatMarkdownDocument(chat: ChatExportInput, opts: DomainMarkdownExportOptions = {}): Promise<FormattedResult> {
    const { conversation, resourceHints } = parsedForExport(chat);
    return { content: await exportDomainMarkdown(conversation, { ...opts, resourceHints }), ext: 'md', mime: 'text/markdown' };
}

export function formatContent(
    chat: any,
    formatType: string
): FormattedResult {
    if (chat && typeof chat === 'object' && 'parsed' in chat) { const { parsed: _native, ...record } = chat; chat = record; }
    if (formatType === 'json_openai') {
        return {
            content: toOpenAIJson(chat),
            ext: 'json',
            mime: 'application/json'
        };
    }
    if (formatType === 'json_raw') {
        return {
            content: toJsonRaw(chat),
            ext: 'json',
            mime: 'application/json'
        };
    }
    if (formatType === 'json') {
        return {
            content: toJsonStandard(chat),
            ext: 'json',
            mime: 'application/json'
        };
    }
    // Fail-closed: unsupported format must throw explicitly
    throw new Error(`[chatFormatter] unsupported format: ${formatType}`);
}

export {
    convertHtmlToMarkdown,
    toOpenAIJson,
    toJsonStandard,
    toJsonRaw
};

export const ChatFormatter: ChatFormatterModule = {
    convertHtmlToMarkdown,
    toOpenAIJson,
    formatContent,
    formatHtmlDocument,
    formatMarkdownDocument
};

export default ChatFormatter;
