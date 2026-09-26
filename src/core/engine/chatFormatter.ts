/**
 * chatFormatter.ts
 * Unified export formatter facade for Gemini conversations.
 * Delegates to specialized formatters: markdownFormatter, jsonFormatter, htmlConverter, and htmlTemplate.
 */
import { toHtml } from "./template/htmlTemplate.js";
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
    toHtml: (chat: any, opts?: ChatFormatterOptions) => string;
    formatContent: (chat: any, formatType?: string, opts?: ChatFormatterOptions) => FormattedResult;
    formatHtmlCanonical: (chat: any, opts?: CanonicalHtmlExportOptions) => Promise<FormattedResult>;
}

export interface CanonicalHtmlExportOptions {
    lang?: 'zh' | 'en';
    theme?: 'dark' | 'light';
}

/**
 * The legacy toHtml() path tolerated duplicate message ids (e.g. the
 * detail pagination in pagination.ts re-fetches a page and its
 * seenMsgIds dedup explicitly bypasses messages whose id equals the
 * conversation id). The canonical projection requires unique ids and
 * throws CanonicalProjectionError otherwise, which would turn a
 * previously-working export into a failed one. The migration adapter
 * therefore restores the uniqueness invariant up front: keep the first
 * occurrence of each message id, preserve order, keep id-less messages.
 */
function dedupeMessagesById(chat: any): any {
    if (!chat || typeof chat !== 'object') return chat;
    const dedupeList = (messages: any): any[] | null => {
        if (!Array.isArray(messages)) return null;
        const seen = new Set<string>();
        let dropped = 0;
        const kept = messages.filter((m: any) => {
            const rawId = m?.id;
            const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : null;
            if (id === null || id === '') return true;
            if (seen.has(id)) { dropped++; return false; }
            seen.add(id);
            return true;
        });
        return dropped > 0 ? kept : null;
    };
    let out = chat;
    const top = dedupeList(chat.messages);
    if (top) out = { ...out, messages: top };
    if (Array.isArray(chat.turns)) {
        let turnsChanged = false;
        const turns = chat.turns.map((t: any) => {
            const inner = dedupeList(t?.messages);
            if (inner) { turnsChanged = true; return { ...t, messages: inner }; }
            return t;
        });
        if (turnsChanged) out = { ...out, turns };
    }
    return out;
}

/**
 * Item 1 — production HTML export route:
 * Conversation -> normalizeGeminiConversation() -> CanonicalHtmlRenderer.
 *
 * Asset URLs fall back to each asset's storageRef (the `assets/...` relative
 * layout the export pipeline already writes), so the renderer needs no
 * external AssetResolver plumbing here.
 *
 * The legacy sync toHtml() stays as a reference/visual-shell helper only
 * (renderCanonicalHtml still shares GEM_HTML_CSS / GEM_HTML_SCRIPT from
 * htmlTemplate.ts); it is no longer the production export path.
 */
export async function formatHtmlCanonical(
    chat: any,
    opts: CanonicalHtmlExportOptions = {}
): Promise<FormattedResult> {
    const { bundle } = await normalizeGeminiConversation(dedupeMessagesById(chat));
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
    formatContent,
    formatHtmlCanonical
};

export default ChatFormatter;
