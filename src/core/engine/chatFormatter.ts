import { isResourceConversationParseResult } from '../parsers/parsingResult.js';
import type { ResourceConversationParseResult } from '../parsers/parsingResult.js';
import type { DomainConversationDetail } from '../domain/conversationDetail.js';
import { assertDomainClosure } from '../domain/closure.js';
import { exportDomainHtml, exportDomainMarkdown, type DomainHtmlExportOptions, type DomainMarkdownExportOptions } from '../export/exportDomainDocument.js';
import { convertHtmlToMarkdown } from '../parsers/shared/html/htmlToMarkdown.js';
import { toOpenAIJson, toJsonStandard, toJsonRaw } from './formatters/jsonFormatter.js';

export interface FormattedResult { content: string; ext: string; mime: string }
export type ChatExportInput = ResourceConversationParseResult | DomainConversationDetail;
export function nativeExportInput(input: ChatExportInput): ResourceConversationParseResult {
    if (isResourceConversationParseResult(input)) return input;
    assertDomainClosure(input);
    return { conversation: input, diagnostics: [], resourceHints: {}, acquisitionHints: {} };
}
export async function formatHtmlDocument(input: ChatExportInput, opts: DomainHtmlExportOptions = {}): Promise<FormattedResult> {
    const { conversation, resourceHints } = nativeExportInput(input);
    return { content: await exportDomainHtml(conversation, { ...opts, resourceHints }), ext: 'html', mime: 'text/html' };
}
export async function formatMarkdownDocument(input: ChatExportInput, opts: DomainMarkdownExportOptions = {}): Promise<FormattedResult> {
    const { conversation, resourceHints } = nativeExportInput(input);
    return { content: await exportDomainMarkdown(conversation, { ...opts, resourceHints }), ext: 'md', mime: 'text/markdown' };
}
export function formatContent(input: ChatExportInput, formatType: string): FormattedResult {
    const result = nativeExportInput(input);
    const content = formatType === 'json_openai' ? toOpenAIJson(result)
        : formatType === 'json' ? toJsonStandard(result)
        : formatType === 'json_raw' ? toJsonRaw(result)
        : undefined;
    if (content === undefined) throw new Error(`[chatFormatter] unsupported format: ${formatType}`);
    return { content, ext: 'json', mime: 'application/json' };
}
export { convertHtmlToMarkdown, toOpenAIJson, toJsonStandard, toJsonRaw };
export const ChatFormatter = { convertHtmlToMarkdown, toOpenAIJson, formatContent, formatHtmlDocument, formatMarkdownDocument };
export type ChatFormatterModule = typeof ChatFormatter;
export default ChatFormatter;
