/**
 * chatFormatter.ts
 * Unified export formatter facade for Gemini conversations.
 * Delegates to specialized formatters: markdownFormatter, jsonFormatter, htmlConverter, and htmlTemplate.
 */
import { toHtml } from "./template/htmlTemplate.js";
import {
    adjustHeadingHierarchy,
    renderAttachments,
    cleanMessageBody,
    sanitizeUserPrompt,
    toMarkdown,
    type MarkdownFormatterOptions
} from "./formatters/markdownFormatter.js";
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

export type ChatFormatterOptions = MarkdownFormatterOptions;

export interface ChatFormatterModule {
    adjustHeadingHierarchy: (text: string, shift?: number) => string;
    renderAttachments: (atts?: any[] | null, isEn?: boolean) => string;
    convertHtmlToMarkdown: (html?: string | null) => string;
    cleanMessageBody: (text?: string | null) => string;
    toMarkdown: (chat: any, opts?: ChatFormatterOptions) => string;
    toOpenAIJson: (chat: any) => string;
    toHtml: (chat: any, opts?: ChatFormatterOptions) => string;
    formatContent: (chat: any, formatType?: string, opts?: ChatFormatterOptions) => FormattedResult;
}

/**
 * Unified content formatter entry point.
 */
export function formatContent(
    chat: any,
    formatType: string = 'markdown',
    opts: ChatFormatterOptions = {}
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
    if (formatType === 'markdown') {
        return {
            content: toMarkdown(chat, opts),
            ext: 'md',
            mime: 'text/markdown'
        };
    }
    if (formatType === 'html') {
        return {
            content: toHtml(chat, opts),
            ext: 'html',
            mime: 'text/html'
        };
    }
    // P2 fail-closed: unsupported format must throw explicitly
    throw new Error(`[chatFormatter] unsupported format: ${formatType}`);
}

export {
    adjustHeadingHierarchy,
    renderAttachments,
    convertHtmlToMarkdown,
    cleanMessageBody,
    sanitizeUserPrompt,
    toMarkdown,
    toOpenAIJson,
    toJsonStandard,
    toJsonRaw,
    toHtml
};

export const ChatFormatter: ChatFormatterModule = {
    adjustHeadingHierarchy,
    renderAttachments,
    convertHtmlToMarkdown,
    cleanMessageBody,
    toMarkdown,
    toOpenAIJson,
    toHtml,
    formatContent
};

export default ChatFormatter;
