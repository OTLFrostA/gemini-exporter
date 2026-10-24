import { formatUnknownPayload } from '../../../../l2/content/unknownFallback.js';
import type { BlockNode } from '../../../../l2/content/blocks.js';
import { parseMarkdownToBlocks, type MarkdownParseContext } from '../../shared/markdown/index.js';
import type { ResourceEvidence as ResourceEvidence } from '../../shared/resources/resourceEvidence.js';
import { extractImageEvidence } from '../rpc/sourceAttachments.js';
import { convertHtmlToMarkdown } from '../../shared/html/htmlToMarkdown.js';
import { stripInternalChipMarkdown } from '../../shared/chipUtils.js';
import { preprocessGeminiMarkdown, normalizeGeminiTexAliases } from './markdownCompatibility.js';
import { geminiStructuredToContent, type GeminiSourceCitations } from './structuredContentAdapter.js';
import type { InlineNode } from '../../../../l2/content/inline.js';
import { normalizeTextUnderscores } from '../../../../shared/utils/latexCompatibility.js';
import { hasLiteralMathText, recoverLiteralMath } from './literalMathRecovery.js';

/** Work only on parsed math nodes; code, user prose and file names stay literal. */
function normalizeGeminiMath(blocks: BlockNode[]): BlockNode[] {
    const math = (source: string): string => normalizeGeminiTexAliases(normalizeTextUnderscores(source));
    const inlines = (nodes: InlineNode[]): void => nodes.forEach(node => {
        if (node.type === 'inlineMath') node.source = math(node.source);
        else if ('children' in node) inlines(node.children);
    });
    const visit = (nodes: BlockNode[]): void => nodes.forEach(node => {
        if (node.type === 'math') node.source = math(node.source);
        else if ('children' in node) inlines(node.children);
        else if (node.type === 'quote') visit(node.blocks);
        else if (node.type === 'list') node.items.forEach(item => visit(item.blocks));
        else if (node.type === 'table') {
            if (node.caption) inlines(node.caption);
            [...(node.headerRows ?? []), ...node.rows].forEach(row => row.cells.forEach(cell => inlines(cell.children)));
        } else if ((node.type === 'image' && node.caption) || (node.type === 'file' && node.description)) {
            inlines(node.type === 'image' ? node.caption! : node.description!);
        }
    });
    visit(blocks);
    return blocks;
}

/** Native RPC prompts are literal textbox contents, not model-authored Markdown. */
export function parseGeminiPrompt(content: string): BlockNode[] {
    if (!content) return [];
    const children: InlineNode[] = [];
    content.split(/\r\n|\r|\n/).forEach((text, index) => {
        if (index) children.push({ type: 'lineBreak', kind: 'hard' });
        if (text) children.push({ type: 'text', text });
    });
    return [{ type: 'paragraph', children }];
}

function cleanGeminiBody(text: string): string {
    return stripInternalChipMarkdown(convertHtmlToMarkdown(text));
}

/** Provider syntax ends here. Resource references are bound by the caller's neutral parse hook. */
export function parseGeminiBody(
    content: unknown,
    structuredContent?: unknown,
    context: MarkdownParseContext & { sourceCitations?: GeminiSourceCitations; recoverLiteralMath?: boolean } = { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'content' } },
): BlockNode[] {
    const cleaned = typeof content === 'string' ? cleanGeminiBody(content) : '';
    if (structuredContent) {
        // Malformed provider data must never prevent the visible raw body from being exported.
        try {
            const structured = geminiStructuredToContent(structuredContent, context.sourceCitations);
            if (structured !== null && (structured.length > 0 || !cleaned.trim())) {
                if (context.recoverLiteralMath !== false && cleaned.includes('$') && hasLiteralMathText(structured)) {
                    const markdown = parseMarkdownToBlocks(preprocessGeminiMarkdown(cleaned), '', {
                        ...context, diagnostics: [], lineStartDisplayMath: true, preserveCodeFenceFinalNewline: true,
                    });
                    const recovered = recoverLiteralMath(structured, markdown);
                    if (recovered) context.diagnostics.push({ severity: 'info', code: 'GEMINI_LITERAL_MATH_RECOVERED',
                        message: 'Recovered native literal math from the matching raw Markdown paragraph',
                        sourceRef: context.sourceRef, details: { recovered } });
                }
                return normalizeGeminiMath(structured);
            }
        } catch {
            // Includes malformed annotation arrays and nested provider containers.
        }
        context.diagnostics.push({
            severity: 'warning', code: 'GEMINI_STRUCTURED_FALLBACK',
            message: 'Structured body could not be adapted; using Markdown fallback',
            sourceRef: context.sourceRef, details: { reason: 'adapter_rejected' },
        });
    }
    // GM-MD-004: display fences without blank lines; fenced code preserves its
    // physical final newline just as the native code string does.
    if (typeof content === 'string') return normalizeGeminiMath(parseMarkdownToBlocks(preprocessGeminiMarkdown(cleaned), '', {
        ...context, lineStartDisplayMath: true, preserveCodeFenceFinalNewline: true,
    }));
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
export function parseSourceReasoning(reasoning: unknown, context: MarkdownParseContext): BlockNode[] | undefined {
    if (typeof reasoning !== 'string') return undefined;
    const cleaned = cleanGeminiBody(reasoning);
    return cleaned.trim() ? normalizeGeminiMath(parseMarkdownToBlocks(preprocessGeminiMarkdown(cleaned), '', context)) : undefined;
}
