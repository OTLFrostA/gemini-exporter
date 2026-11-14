import type { RootContent, PhrasingContent } from 'mdast';
import { parseMarkdownAst } from './markdown/parseMarkdown.js';

const INTERNAL_CHIP_TOKEN_PATTERN =
    '(?:immersive_entry_chip|deep_research(?:_confirmation_content)?|map_(?:content|location(?:_reference)?)|grounding_content|web_search(?:_content)?|youtube_content|flights_content|hotels_content|workspace_content|shopping_content|lmdx_image|image_?generation_?content|generated_image)';

const INTERNAL_CHIP_URL_RE = new RegExp(
    `https?:\\/\\/googleusercontent\\.com\\/${INTERNAL_CHIP_TOKEN_PATTERN}`,
    'i'
);

export function isInternalChipUrl(u?: string | null): boolean {
    if (!u) return false;
    return INTERNAL_CHIP_URL_RE.test(u);
}

export function stripInternalChipMarkdown(text?: string | null): string {
    if (!text) return '';
    if (!isInternalChipUrl(text) && !/<(?:Image|ElicitationsGroup|Elicitation|FollowUp|GenerateWidget)\b/i.test(text)) return text;

    // Provider markup can also appear as authored example code. Work around
    // parsed code/math and escaped text using source offsets, preserving every
    // byte of those literals (and preventing paired tags from spanning them).
    const protectedRanges: Array<{ start: number; end: number }> = [];
    const visit = (nodes: readonly (RootContent | PhrasingContent)[]): void => {
        for (const node of nodes) {
            if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'math' || node.type === 'inlineMath'
                || node.type === 'text' && /\\[<>]/.test(text.slice(node.position?.start.offset, node.position?.end.offset))) {
                const start = node.position?.start.offset, end = node.position?.end.offset;
                if (start !== undefined && end !== undefined) protectedRanges.push({ start, end });
            } else if ('children' in node) visit(node.children);
        }
    };
    visit(parseMarkdownAst(text).children);
    let cursor = 0;
    const parts: string[] = [];
    for (const range of protectedRanges) {
        parts.push(stripChipMarkup(text.slice(cursor, range.start), false), text.slice(range.start, range.end));
        cursor = range.end;
    }
    parts.push(stripChipMarkup(text.slice(cursor)));
    return parts.join('');
}

function stripChipMarkup(text: string, atEnd = true): string {

    const standaloneRe = new RegExp(
        `(?:^|\\n)\\s*(?:\\[)?https?:\\/\\/googleusercontent\\.com\\/${INTERNAL_CHIP_TOKEN_PATTERN}(?:\\/[^\\s\\n\\]]*)?(?:\\])?\\s*(?=\\n${atEnd ? '|$' : ''})`,
        'gi'
    );
    const linkWithTitleRe = new RegExp(
        `\\[([^\\]]+)\\]\\(https?:\\/\\/googleusercontent\\.com\\/${INTERNAL_CHIP_TOKEN_PATTERN}[^\\)]*\\)`,
        'gi'
    );
    const rawUrlRe = new RegExp(
        `https?:\\/\\/googleusercontent\\.com\\/${INTERNAL_CHIP_TOKEN_PATTERN}(?:\\/[^\\s\\n\\)]*)?`,
        'gi'
    );

    const imageAgentTagRe = /<Image\s+[^>]*src=["']image_agent_tag_[^"']*["'][^>]*\/?>/gi;
    const elicitationsGroupRe = /<ElicitationsGroup(?=[\s/>])[\s\S]*?<\/ElicitationsGroup>/gi;
    const elicitationPairedRe = /<Elicitation(?=[\s/>])[\s\S]*?<\/Elicitation>/gi;
    const elicitationSelfClosingRe = /<Elicitation(?=[\s/>])[^>]*\/?>/gi;
    const followUpPairedRe = /<FollowUp(?=[\s/>])[\s\S]*?<\/FollowUp>/gi;
    const followUpSelfClosingRe = /<FollowUp(?=[\s/>])[^>]*\/?>/gi;
    const generateWidgetPairedRe = /<GenerateWidget(?=[\s/>])[\s\S]*?<\/GenerateWidget>/gi;
    const generateWidgetSelfClosingRe = /<GenerateWidget(?=[\s/>])[^>]*\/?>/gi;

    let cleaned = text.replace(standaloneRe, '\n');
    cleaned = cleaned.replace(linkWithTitleRe, '$1');
    cleaned = cleaned.replace(rawUrlRe, '');
    cleaned = cleaned.replace(imageAgentTagRe, '');
    cleaned = cleaned.replace(elicitationsGroupRe, '');
    cleaned = cleaned.replace(elicitationPairedRe, '');
    cleaned = cleaned.replace(elicitationSelfClosingRe, '');
    cleaned = cleaned.replace(followUpPairedRe, '');
    cleaned = cleaned.replace(followUpSelfClosingRe, '');
    cleaned = cleaned.replace(generateWidgetPairedRe, '');
    cleaned = cleaned.replace(generateWidgetSelfClosingRe, '');
    // This also receives complete Markdown answers, including fenced code.
    // Preserve authored whitespace; global blank-line cleanup changes code.
    return cleaned;
}
