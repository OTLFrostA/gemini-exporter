import type { BlockNode } from '../../../../l2/content/blocks.js';
import { parseMarkdownToBlocks, type MarkdownParseContext } from '../../shared/markdown/index.js';
import type { ResourceEvidence } from '../../shared/resources/resourceEvidence.js';
import type {
    GeminiPartialStructuredSlot,
    GeminiSourceAttribution,
    GeminiStructuredDocument,
    ImageAttachment,
} from './structuredTypes.js';
import { preprocessGeminiMarkdown, normalizeGeminiTexAliases } from './markdownCompatibility.js';
import { geminiStructuredToContent, type GeminiSourceCitations, type GeminiSourceFailure, type GeminiStructuredContext } from './structuredContentAdapter.js';
import type { InlineNode } from '../../../../l2/content/inline.js';
import { normalizeTextUnderscores } from '../../../../shared/utils/latexCompatibility.js';
import { hasRecoverableTableContent, recoverTableContent } from './tableContentRecovery.js';
import { hasLiteralMathText, recoverLiteralMath } from './literalMathRecovery.js';
import { recoverGeminiSourceRanges } from './sourceRanges.js';
import { cleanGeminiBodyText, createCandidateMarkdownIndex } from './candidateMarkdown.js';
import { recoverPartialStructuredBlocks } from './partialStructuredRecovery.js';

interface GeminiBodyParseContext extends MarkdownParseContext, Pick<GeminiStructuredContext, 'uncitedPageMetadata'> {
    sourceCitations?: GeminiSourceCitations;
    recoverLiteralMath?: boolean;
    onStructuredFallback?: (reason: 'source_annotations' | 'body') => void;
    candidateText?: string;
    sourceAttributions?: readonly GeminiSourceAttribution[];
    groundingCitationMarkers?: readonly string[];
    partialSlots?: readonly GeminiPartialStructuredSlot[];
}

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
        } else if (node.type === 'image') {
            if (node.caption) inlines(node.caption);
        } else if (node.type === 'file') {
            if (node.description) inlines(node.description);
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

function applyCandidateContentRecovery(
    blocks: BlockNode[],
    markdownIndex: ReturnType<typeof createCandidateMarkdownIndex>,
    context: GeminiBodyParseContext,
): void {
    if (context.recoverLiteralMath === false || !markdownIndex.cleaned().includes('$')) return;
    if (blocks.some(hasRecoverableTableContent)) {
        const recovered = recoverTableContent(blocks, markdownIndex.referenceBlocks(context));
        if (recovered) context.diagnostics.push({
            severity: 'info', code: 'GEMINI_TABLE_CONTENT_RECOVERED',
            message: 'Recovered table cells or inline math verified against the selected Markdown',
            sourceRef: context.sourceRef, details: { recovered },
        });
    }
    if (hasLiteralMathText(blocks)) {
        const recovered = recoverLiteralMath(blocks, markdownIndex.referenceBlocks(context));
        if (recovered) {
            context.diagnostics.push({
                severity: 'info',
                code: 'GEMINI_LITERAL_MATH_RECOVERED',
                message: 'Recovered native literal math from the matching raw Markdown paragraph',
                sourceRef: context.sourceRef,
                details: { recovered },
            });
        }
    }
}

/** Provider syntax ends here. Resource references are bound by the caller's neutral parse hook. */
export function parseGeminiBody(
    content: string,
    structuredContent?: GeminiStructuredDocument,
    context: GeminiBodyParseContext = { diagnostics: [], sourceRef: { providerId: 'gemini', locator: 'content' } },
): BlockNode[] {
    if (!structuredContent && !context.partialSlots?.length) {
        return normalizeGeminiMath(parseMarkdownToBlocks(
            preprocessGeminiMarkdown(cleanGeminiBodyText(content)),
            '',
            { ...context, lineStartDisplayMath: true, preserveCodeFenceFinalNewline: true },
        ));
    }
    const markdownIndex = createCandidateMarkdownIndex(content, context.candidateText);
    if (structuredContent) {
        const sourceFailures: GeminiSourceFailure[] = [];
        const recovery = recoverGeminiSourceRanges(structuredContent, context.sourceAttributions ?? [], markdownIndex);
        const structured = geminiStructuredToContent(recovery.document, context.sourceCitations,
            { ...context, onSourceFallback: failure => { sourceFailures.push(failure); } });
        if (structured !== null && (structured.length > 0 || !markdownIndex.cleaned().trim())) {
            if (recovery.recovered) context.diagnostics.push({
                severity: 'info',
                code: 'GEMINI_SOURCE_RANGE_RECOVERED',
                message: 'Recovered invalid source coordinates from verified selected-candidate quotes and unique native anchors',
                sourceRef: context.sourceRef,
                details: { recovered: recovery.recovered, method: 'exact_selected_source_quote' },
            });
            if (sourceFailures.length) {
                context.onStructuredFallback?.('source_annotations');
                context.diagnostics.push({
                    severity: 'warning',
                    code: 'GEMINI_SOURCE_ANNOTATION_FALLBACK',
                    message: 'Preserved native body and available sources; exact source anchoring is unverified',
                    sourceRef: context.sourceRef,
                    details: {
                        reason: 'source_annotations_unrepresented',
                        sourceFailures,
                        structuredDocumentJson: JSON.stringify(structuredContent),
                        fallbackMarkdown: content,
                        ...(context.sourceCitations?.size ? { sourceCitationsJson: JSON.stringify([...context.sourceCitations]) } : {}),
                    },
                });
            }
            applyCandidateContentRecovery(structured, markdownIndex, context);
            return normalizeGeminiMath(structured);
        }
        context.onStructuredFallback?.('body');
        context.diagnostics.push({
            severity: 'warning',
            code: 'GEMINI_STRUCTURED_FALLBACK',
            message: 'Structured body could not be adapted; using Markdown fallback',
            sourceRef: context.sourceRef,
            details: {
                reason: 'adapter_rejected',
                structuredDocumentJson: JSON.stringify(structuredContent),
                fallbackMarkdown: content,
                ...(context.sourceCitations?.size ? { sourceCitationsJson: JSON.stringify([...context.sourceCitations]) } : {}),
            },
        });
        const partial = recoverPartialStructuredBlocks({
            slots: structuredContent.children.map(node => ({ kind: 'decoded', node })),
            markdownIndex,
            sourceCitations: context.sourceCitations,
            sourceAttributions: context.sourceAttributions,
            groundingCitationMarkers: context.groundingCitationMarkers,
            context,
        });
        if (partial) {
            applyCandidateContentRecovery(partial.blocks, markdownIndex, context);
            return normalizeGeminiMath(partial.blocks);
        }
    } else if (context.partialSlots?.length) {
        const partial = recoverPartialStructuredBlocks({
            slots: context.partialSlots,
            markdownIndex,
            sourceCitations: context.sourceCitations,
            sourceAttributions: context.sourceAttributions,
            groundingCitationMarkers: context.groundingCitationMarkers,
            context,
        });
        if (partial) {
            applyCandidateContentRecovery(partial.blocks, markdownIndex, context);
            return normalizeGeminiMath(partial.blocks);
        }
    }
    return normalizeGeminiMath(markdownIndex.fallbackBlocks(context));
}

/** Adapt body-local facts already decoded by the resource pipeline. */
export function structuredBodyAttachments(message: { structuredImages: ImageAttachment[] }): ResourceEvidence[] {
    return message.structuredImages.map(image => ({
        ...image,
        type: 'image',
        src: image.sourceUrl,
        name: image.fileName ?? image.title,
        title: image.fileName ?? image.title,
    }));
}

/** Parse provider-exposed reasoning before it crosses the semantic input boundary. */
export function parseSourceReasoning(reasoning: string | undefined, context: MarkdownParseContext): BlockNode[] | undefined {
    if (reasoning === undefined) return undefined;
    const cleaned = cleanGeminiBodyText(reasoning);
    return cleaned.trim() ? normalizeGeminiMath(parseMarkdownToBlocks(preprocessGeminiMarkdown(cleaned), '', context)) : undefined;
}
