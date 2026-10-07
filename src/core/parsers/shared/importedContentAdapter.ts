import type { BlockNode } from '../../domain/content/blocks.js';
import { parseMarkdownToBlocks, type MarkdownParseContext } from './markdown/index.js';
import { convertHtmlToMarkdown } from './html/htmlToMarkdown.js';

/** Current OpenAI import input is text/Markdown, with legacy HTML accepted at this boundary. */
export function parseImportedBody(
    content: string,
    context: MarkdownParseContext = { diagnostics: [], sourceRef: { providerId: 'openai', locator: 'content' } },
): BlockNode[] {
    return parseMarkdownToBlocks(convertHtmlToMarkdown(content), '', context);
}
