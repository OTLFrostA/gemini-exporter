import {
    normalizeGeminiConversation,
    CanonicalHtmlRenderer,
    renderCanonicalMarkdown,
    type CanonicalMarkdownOptions,
    type RenderContext
} from "../export/canonical/index.js";
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
    formatMarkdownCanonical: (chat: any, opts?: CanonicalMarkdownOptions) => Promise<FormattedResult>;
    formatHtmlCanonical: (chat: any, opts?: CanonicalHtmlExportOptions) => Promise<FormattedResult>;
}

export interface CanonicalHtmlExportOptions {
    lang?: 'zh' | 'en';
    theme?: 'dark' | 'light';
}

/**
 * Production HTML export route:
 * Conversation -> normalizeGeminiConversation() -> HTML composer -> Document AST -> HTML backend.
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
        assets: { resolve: async (id) => {
            const asset = bundle.assets.find((entry) => entry.id === id);
            return asset?.storageRef ? { asset, renderUrl: asset.storageRef } : null;
        } },
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

export async function formatMarkdownCanonical(
    chat: any,
    opts: CanonicalMarkdownOptions = {},
): Promise<FormattedResult> {
    const { bundle, diagnostics } = await normalizeGeminiConversation(chat);
    const integrityError = diagnostics.find((d) => d.severity === 'error' && (d.code === 'MSG_BAD_ID' || d.code === 'MSG_DUP_ID'));
    if (integrityError) throw new Error(`[${integrityError.code}] ${integrityError.message}`);
    return { content: renderCanonicalMarkdown(bundle, opts), ext: 'md', mime: 'text/markdown' };
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
