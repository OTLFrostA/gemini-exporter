import type { Conversation } from '../../types/conversation.js';
import { parseLegacyConversation } from '../domain/legacyConversationAdapter.js';
import { exportDomainHtml, exportDomainMarkdown, type DomainHtmlExportOptions, type DomainMarkdownExportOptions } from '../export/document/exportDomainDocument.js';
import { convertHtmlToMarkdown } from "./formatters/htmlConverter.js";
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
    formatMarkdownCanonical: (chat: any, opts?: DomainMarkdownExportOptions) => Promise<FormattedResult>;
    formatHtmlCanonical: (chat: any, opts?: CanonicalHtmlExportOptions) => Promise<FormattedResult>;
}

export type ChatExportInput = Omit<Conversation, 'timestamp'> & { timestamp?: number | null };

/** Legacy public names retained for callers; both routes now use Domain -> Document AST. */
export type CanonicalHtmlExportOptions = DomainHtmlExportOptions;

export async function formatHtmlCanonical(chat: ChatExportInput, opts: DomainHtmlExportOptions = {}): Promise<FormattedResult> {
    const { conversation, resourceHints } = parseLegacyConversation({ ...chat, timestamp: chat.timestamp ?? null });
    return { content: await exportDomainHtml(conversation, { ...opts, resourceHints }), ext: 'html', mime: 'text/html' };
}

export async function formatMarkdownCanonical(chat: ChatExportInput, opts: DomainMarkdownExportOptions = {}): Promise<FormattedResult> {
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
    formatHtmlCanonical,
    formatMarkdownCanonical
};

export default ChatFormatter;
