import type { PhrasingContent, Root, RootContent } from 'mdast';
import type { BlockNode } from '../../../../l2/content/blocks.js';
import {
    collectDefinitions,
    mdastRootToBlocks,
    parseMarkdownAst,
    type MarkdownParseContext,
} from '../../shared/markdown/index.js';
import { convertHtmlToMarkdown } from '../../shared/html/htmlToMarkdown.js';
import { stripInternalChipMarkdown } from '../../shared/chipUtils.js';
import { preprocessGeminiMarkdown } from './markdownCompatibility.js';

export interface CandidateParagraphSpan {
    readonly start: number;
    readonly end: number;
    readonly offset: number;
}

export interface CandidateParagraphProjection {
    readonly text: string;
    readonly start: number;
    readonly end: number;
    readonly spans: readonly CandidateParagraphSpan[];
}

export function cleanGeminiBodyText(text: string): string {
    return stripInternalChipMarkdown(convertHtmlToMarkdown(text));
}

/** Project source positions through a complete Markdown paragraph, rather than
 * reparsing a quote that may start/end inside a code span or style delimiter.
 * Only unchanged literal text and exact code contents have a proven position
 * mapping. Escapes, entities, padded/multiline code and unsupported nodes refuse
 * this path instead of approximating coordinates. */
export function projectCandidateParagraphs(markdown: string, preParsedAst?: Root): CandidateParagraphProjection[] {
    const paragraphs: CandidateParagraphProjection[] = [];
    const visit = (nodes: readonly (RootContent | PhrasingContent)[]): void => {
        for (const block of nodes) {
            if (block.type !== 'paragraph' && block.type !== 'heading' && block.type !== 'tableCell') {
                if ('children' in block) visit(block.children);
                continue;
            }
            const blockStart = block.position?.start.offset, blockEnd = block.position?.end.offset;
            if (blockStart === undefined || blockEnd === undefined) continue;
            let text = '';
            const spans: CandidateParagraphSpan[] = [];
            const inlines = (children: readonly PhrasingContent[]): boolean => {
                for (const node of children) {
                    if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'delete' || node.type === 'link') {
                        if (!inlines(node.children)) return false;
                        continue;
                    }
                    let start = node.position?.start.offset;
                    const end = node.position?.end.offset;
                    if (start === undefined || end === undefined || (node.type !== 'text' && node.type !== 'inlineCode')) return false;
                    if (node.type === 'inlineCode') {
                        const raw = markdown.slice(start, end);
                        const delimiter = /^`+/.exec(raw)?.[0];
                        if (!delimiter || raw.slice(delimiter.length, -delimiter.length) !== node.value) return false;
                        start += delimiter.length;
                    } else if (markdown.slice(start, end) !== node.value) return false;
                    spans.push({ start, end: start + node.value.length, offset: text.length });
                    text += node.value;
                }
                return true;
            };
            if (inlines(block.children) && text) paragraphs.push({ text, start: blockStart, end: blockEnd, spans });
        }
    };
    const root = preParsedAst ?? parseMarkdownAst(markdown);
    visit(root.children);
    return paragraphs;
}

export interface CandidateMarkdownIndex {
    readonly rawCandidateText: string | undefined;
    cleaned(): string;
    preprocessed(): string;
    paragraphs(): readonly CandidateParagraphProjection[];
    /** Silent BlockNode[] projection cached once for literal-math and partial-block alignment. */
    referenceBlocks(baseContext: MarkdownParseContext): BlockNode[];
    /** Authoritative fallback BlockNode[] conversion emitting diagnostics into `context`. */
    fallbackBlocks(context: MarkdownParseContext): BlockNode[];
}

/** Lazy, single-pass Markdown AST cache shared across chip stripping, source-range
 * coordinate projection, literal-math recovery, and partial block-level alignment. */
export function createCandidateMarkdownIndex(content: string, candidateText?: string): CandidateMarkdownIndex {
    let cleanedCache: string | undefined;
    let preprocessedCache: string | undefined;
    let cleanedTreeCache: Root | null | undefined;
    let rawParagraphsCache: readonly CandidateParagraphProjection[] | undefined;
    let referenceBlocksCache: BlockNode[] | undefined;

    const cleaned = (): string => {
        if (cleanedCache === undefined) cleanedCache = cleanGeminiBodyText(content);
        return cleanedCache;
    };

    const preprocessed = (): string => {
        if (preprocessedCache === undefined) preprocessedCache = preprocessGeminiMarkdown(cleaned());
        return preprocessedCache;
    };

    const cleanedTree = (): Root | null => {
        if (cleanedTreeCache === undefined) {
            const source = preprocessed();
            cleanedTreeCache = source.trim() ? parseMarkdownAst(source) : null;
        }
        return cleanedTreeCache;
    };

    const blocksWithContext = (ctx: MarkdownParseContext): BlockNode[] => {
        const tree = cleanedTree();
        if (!tree) return [];
        const source = preprocessed();
        const definitions = new Map<string, { url: string; title?: string }>();
        collectDefinitions(tree, definitions);
        return mdastRootToBlocks(tree, {
            ...ctx,
            definitions,
            lineStartDisplayMath: true,
            preserveCodeFenceFinalNewline: true,
        }, source);
    };

    return {
        rawCandidateText: candidateText,
        cleaned,
        preprocessed,
        paragraphs() {
            if (rawParagraphsCache === undefined) {
                rawParagraphsCache = candidateText === undefined ? [] : projectCandidateParagraphs(candidateText);
            }
            return rawParagraphsCache;
        },
        referenceBlocks(baseContext) {
            if (referenceBlocksCache === undefined) {
                referenceBlocksCache = blocksWithContext({ ...baseContext, diagnostics: [] });
            }
            return referenceBlocksCache;
        },
        fallbackBlocks(context) {
            const blocks = blocksWithContext(context);
            // Release transient MDAST once terminal fallback blocks are materialized.
            cleanedTreeCache = undefined;
            return blocks;
        },
    };
}
