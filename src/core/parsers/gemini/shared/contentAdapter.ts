import { formatUnknownPayload } from '../../../domain/content/unknownFallback.js';
import type { BlockNode } from '../../../domain/content/blocks.js';
import { parseMarkdownToBlocks, type MarkdownParseContext } from '../../shared/markdown/index.js';
import type { ResourceEvidence as ResourceEvidence } from '../../shared/resources/resourceEvidence.js';
import { extractImageEvidence } from '../rpc/sourceAttachments.js';
import { convertHtmlToMarkdown } from '../../shared/html/htmlToMarkdown.js';
import { stripInternalChipMarkdown } from '../../../utils/chipUtils.js';
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

/** Collect structured resource evidence; the input adapter resolves overlap with legacy lists. */
export function structuredBodyAttachments(message: { structuredContent?: unknown }, readImages: typeof extractImageEvidence = extractImageEvidence): ResourceEvidence[] {
    if (!message.structuredContent) return [];
    return readImages(message.structuredContent).map(image => ({
        ...image, type: 'image', src: image.sourceUrl,
        name: image.fileName ?? image.title, title: image.fileName ?? image.title,
    }));
}

/** Parse provider-exposed reasoning before it crosses the semantic input boundary. */
export function parseLegacyReasoning(reasoning: unknown, context: MarkdownParseContext): BlockNode[] | undefined {
    if (typeof reasoning !== 'string') return undefined;
    const cleaned = cleanGeminiBody(reasoning);
    return cleaned.trim() ? parseMarkdownToBlocks(preprocessGeminiMarkdown(cleaned), '', context) : undefined;
}
