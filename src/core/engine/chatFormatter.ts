import type { ResourceResult, ResourceDelivery } from '../resources/resourceResult.js';
import { isResourceConversationParseResult, type ResourceConversationParseResult } from '../parsers/parsingResult.js';
import type { TrustedDomain } from '../domain/runtimeValidation.js';
import { exportDomainHtml, exportDomainMarkdown, type DomainHtmlExportOptions, type DomainMarkdownExportOptions } from '../export/exportDomainDocument.js';
import { convertHtmlToMarkdown } from '../parsers/shared/html/htmlToMarkdown.js';
import { toJsonStandard } from './formatters/jsonFormatter.js';

export interface FormattedResult { content: string; ext: string; mime: string }
export type ChatExportInput = ResourceConversationParseResult;
export function nativeExportInput(input: ChatExportInput): ResourceConversationParseResult {
    if ('conversation' in input) {
        if (!isResourceConversationParseResult(input)) throw new TypeError('Malformed native conversation result');
        return input;
    }
    throw new TypeError('Export requires an Account and committed conversation');
}
export async function formatHtmlDocument(input: ChatExportInput, opts: DomainHtmlExportOptions = {}): Promise<FormattedResult> {
    const parsed = nativeExportInput(input);
    const conversation = parsed.conversation;
    return { content: await exportDomainHtml(conversation, parsed.account, opts), ext: 'html', mime: 'text/html' };
}
export async function formatMarkdownDocument(input: ChatExportInput, opts: DomainMarkdownExportOptions = {}): Promise<FormattedResult> {
    const parsed = nativeExportInput(input);
    const conversation = parsed.conversation;
    return { content: await exportDomainMarkdown(conversation, parsed.account, opts), ext: 'md', mime: 'text/markdown' };
}
export function formatContent(input: ChatExportInput, formatType: string, resources: readonly ResourceResult<ResourceDelivery>[] = []): FormattedResult {
    const result = nativeExportInput(input);
    if (formatType !== 'json') throw new Error(`[chatFormatter] unsupported format: ${formatType}`);
    const content = toJsonStandard(result, resources);
    return { content, ext: 'json', mime: 'application/json' };
}
export { convertHtmlToMarkdown, toJsonStandard };
export const ChatFormatter = { convertHtmlToMarkdown, formatContent, formatHtmlDocument, formatMarkdownDocument };
export type ChatFormatterModule = typeof ChatFormatter;
export default ChatFormatter;
