import { normalizeTexBracketsInProse, transformMarkdownOutsideCode } from '../shared/markdown/texBrackets.js';

const URL_CITATION = /\uE200[\uE200-\uE202]*url[\uE200-\uE202]+([^\uE200-\uE202]+)[\uE200-\uE202]+([^\uE200-\uE202]+)\uE201/g;
const CITE_MARKER = /[\uE200][\uE200-\uE202]*cite(?:[\uE200-\uE202]*turn[0-9a-z]*)+[\uE200-\uE202]*/g;
const CITATION_DELIMITERS = /[\uE200-\uE202]+/g;
const BR_TAG = /<br\s*\/?>/gi;

function stripCitationsOutsideCode(text: string): string {
    return text
        .replace(URL_CITATION, (_m: string, title: string, url: string) => `[${title.trim()}](${url.trim()})`)
        .replace(CITE_MARKER, '')
        .replace(CITATION_DELIMITERS, '');
}

/** Normalize one ChatGPT message body for the shared Markdown parser. */
export function preprocessChatGPTMarkdown(source: string): string {
    return transformMarkdownOutsideCode(source, part =>
        stripCitationsOutsideCode(normalizeTexBracketsInProse(part)).replace(BR_TAG, ' '));
}
