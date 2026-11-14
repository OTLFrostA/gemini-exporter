import { normalizeTexBracketsInProse, transformMarkdownOutsideCode } from '../shared/markdown/texBrackets.js';

const URL_CITATION = /[\uE200][\uE000-\uF8FF]*url[\uE000-\uF8FF]*([^\uE000-\uF8FF]*?)[\uE000-\uF8FF]*([^\uE000-\uF8FF]*?)[\uE201]/g;
const CITE_MARKER = /[\uE200][\uE000-\uF8FF]*cite(?:[\uE000-\uF8FF]*turn[0-9a-z]*)+[\uE000-\uF8FF]*/g;
const PUA_STRAY = /[\uE000-\uF8FF]+/g;
const BR_TAG = /<br\s*\/?>/gi;

function stripCitationsOutsideCode(text: string): string {
    return text
        .replace(URL_CITATION, (_m: string, title: string, url: string) => `[${title.trim()}](${url.trim()})`)
        .replace(CITE_MARKER, '')
        .replace(PUA_STRAY, '');
}

/** Normalize one ChatGPT message body for the shared Markdown parser. */
export function preprocessChatGPTMarkdown(source: string): string {
    return transformMarkdownOutsideCode(source, part =>
        stripCitationsOutsideCode(normalizeTexBracketsInProse(part)).replace(BR_TAG, ' '));
}
