import { normalizeTexBracketsInProse, transformMarkdownOutsideCode } from '../shared/markdown/texBrackets.js';

/** Grok uses TeX brackets; protect fenced and inline code before normalizing them. */
export function preprocessGrokMarkdown(source: string): string {
    return transformMarkdownOutsideCode(source, part => normalizeTexBracketsInProse(part, true));
}
