/**
 * chatFormatter.ts
 * Unified export formatter facade for Gemini conversations.
 * Delegates to specialized formatters: markdownFormatter, jsonFormatter, htmlConverter,
 * plus the canonical HTML renderer (formatHtmlCanonical).
 */
import {
    normalizeGeminiConversation,
    CanonicalHtmlRenderer,
    type RenderContext
} from "../export/canonical/index.js";
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
    formatContent: (chat: any, formatType?: string, opts?: ChatFormatterOptions) => FormattedResult;
    formatHtmlCanonical: (chat: any, opts?: CanonicalHtmlExportOptions) => Promise<FormattedResult>;
}

export interface CanonicalHtmlExportOptions {
    lang?: 'zh' | 'en';
    theme?: 'dark' | 'light';
}

/**
 * Item 1 — production HTML export route:
 * Conversation -> normalizeGeminiConversation() -> CanonicalHtmlRenderer.
 *
 * Asset URLs fall back to each asset's storageRef (the `assets/...` relative
 * layout the export pipeline already writes), so the renderer needs no
 * external AssetResolver plumbing here.
 *
 * Item 2 (P0): the legacy sync toHtml() was removed entirely
 * (htmlTemplate.ts now only provides shared GEM_HTML_CSS /
 * GEM_HTML_SCRIPT / sanitizeUrl for the canonical renderer).
 * HTML export is solely the canonical path below.
 */
export async function formatHtmlCanonical(
    chat: any,
    opts: CanonicalHtmlExportOptions = {}
): Promise<FormattedResult> {
    const { bundle } = await normalizeGeminiConversation(chat);
    const renderer = new CanonicalHtmlRenderer({
        lang: opts.lang === 'en' ? 'en' : 'zh',
        theme: opts.theme === 'light' ? 'light' : 'dark',
    });
    const context: RenderContext = {
        bundle,
        assets: { resolve: async () => null },
        locale: opts.lang === 'en' ? 'en' : 'zh',
        signal: AbortSignal.timeout(60000),
        reportProgress: () => { /* noop: chatFormatter facade has no progress sink */ },
    };
    const artifact = await renderer.render(context);
    return {
        content: artifact.content as string,
        ext: 'html',
        mime: artifact.mimeType,
    };
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
    // NOTE (Item 2): 'html' is intentionally not handled here. HTML export
    // must go through the async formatHtmlCanonical() (Canonical AST path);
    // the legacy sync toHtml() was removed.
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
    toJsonRaw
};

export const ChatFormatter: ChatFormatterModule = {
    adjustHeadingHierarchy,
    renderAttachments,
    convertHtmlToMarkdown,
    cleanMessageBody,
    toMarkdown,
    toOpenAIJson,
    formatContent,
    formatHtmlCanonical
};

export default ChatFormatter;
