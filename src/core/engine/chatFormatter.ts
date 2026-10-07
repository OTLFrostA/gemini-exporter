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

export async function formatHtmlDocument(chat: ChatExportInput, opts: DomainHtmlExportOptions = {}): Promise<FormattedResult> {
    const { conversation, resourceHints } = parseLegacyConversation({ ...chat, timestamp: chat.timestamp ?? null });
    return { content: await exportDomainHtml(conversation, { ...opts, resourceHints }), ext: 'html', mime: 'text/html' };
}

export async function formatMarkdownDocument(chat: ChatExportInput, opts: DomainMarkdownExportOptions = {}): Promise<FormattedResult> {
    const { conversation, resourceHints } = parseLegacyConversation({ ...chat, timestamp: chat.timestamp ?? null });
    return { content: await exportDomainMarkdown(conversation, { ...opts, resourceHints }), ext: 'md', mime: 'text/markdown' };
}

export function formatContent(
    chat: any,
    formatType: string
): FormattedResult {
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
