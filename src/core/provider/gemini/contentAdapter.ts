import { formatUnknownPayload } from '../../export/canonical/unknownFallback.js';
import type { BlockNode } from '../../content/blocks.js';
import { parseMarkdownToBlocks, type MarkdownParseContext } from '../../content/markdown/index.js';
import type { Attachment, ChatMessage } from '../../../types/conversation.js';
import { extractImages } from '../../api/parser/attachments.js';
import { convertHtmlToMarkdown } from '../../engine/formatters/htmlConverter.js';
import { stripInternalChipMarkdown } from '../../utils/chipUtils.js';
import { preprocessGeminiMarkdown } from './markdownCompatibility.js';
import { geminiStructuredToContent } from './structuredContentAdapter.js';

export function cleanGeminiBody(text: string): string {
    return stripInternalChipMarkdown(convertHtmlToMarkdown(text));
}

/** Provider syntax ends here. Resource references are bound by the caller's neutral parse hook. */
export function parseGeminiBody(
    content: unknown,
    structuredContent?: unknown,
    context: MarkdownParseContext = { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'content' } },
): BlockNode[] {
    const cleaned = typeof content === 'string' ? cleanGeminiBody(content) : '';
    if (structuredContent) {
        // Malformed provider data must never prevent the visible raw body from being exported.
        try {
            const structured = geminiStructuredToContent(structuredContent);
            if (structured !== null && (structured.length > 0 || !cleaned.trim())) return structured;
        } catch {
            // Includes malformed annotation arrays and nested provider containers.
        }
    }
    if (typeof content === 'string') return parseMarkdownToBlocks(preprocessGeminiMarkdown(cleaned), '', context);
    if (content === undefined || content === null) return [];
    const visible = formatUnknownPayload(content);
    context.diagnostics.push({
        id: `unknown-content:${context.sourceRef.providerMessageId ?? context.sourceRef.locator}`,
        severity: 'warning', code: 'UNKNOWN_MESSAGE_CONTENT',
        message: 'message content was not a string; preserved as unknown block',
        sourceRef: context.sourceRef, details: { truncated: visible.truncated },
    });
    return [{ type: 'unknown', sourceType: 'message-content', text: visible.text }];
}

/** Keep structured-only attachments at the provider boundary before removing raw payloads from Domain. */
export function structuredBodyAttachments(message: Pick<ChatMessage, 'attachments' | 'images' | 'structuredContent'>): Attachment[] {
    if (message.attachments?.length || message.images?.length || !message.structuredContent) return [];
    return extractImages(message.structuredContent).map(image => ({
        ...image, type: 'image', src: image.sourceUrl,
        name: image.fileName, title: image.fileName,
    }));
}
