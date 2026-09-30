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
 * Production HTML export route:
 * Conversation -> normalizeGeminiConversation() -> CanonicalHtmlRenderer.
 *
 * Asset URLs fall back to each asset's storageRef (the `assets/...` relative
 * layout the export pipeline already writes), so the renderer needs no
 * external AssetResolver plumbing here.
 */
export async function formatHtmlCanonical(
    chat: any,
    opts: CanonicalHtmlExportOptions = {}
): Promise<FormattedResult> {
    const { bundle, diagnostics } = await normalizeGeminiConversation(chat);
    const integrityError = diagnostics.find((d) => d.severity === 'error' && (d.code === 'MSG_BAD_ID' || d.code === 'MSG_DUP_ID'));
    if (integrityError) throw new Error(`[${integrityError.code}] ${integrityError.message}`);
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
    // NOTE: 'html' is intentionally not handled here. HTML export
    // must go through the async formatHtmlCanonical() (Canonical AST path);
    // the legacy sync toHtml() was removed.
    // Fail-closed: unsupported format must throw explicitly
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
