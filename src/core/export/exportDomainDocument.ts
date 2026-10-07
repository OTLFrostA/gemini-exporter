import type { LegacyResourceHints } from '../parsers/shared/resources/resourceHints.js';
import type { DomainConversationDetail } from '../domain/conversationDetail.js';
import { toIso } from '../domain/time.js';
import { composeDomainDocument, type DomainCompositionOptions } from '../document/compose/composeDomainDocument.js';
import { prepareDomainResources } from './assets/prepareDomainResources.js';
import { renderDocumentHtml } from '../renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../renderers/markdown/renderMarkdown.js';
import type { HtmlRenderOptions, MarkdownRenderOptions } from '../renderers/shared/renderOptions.js';

export interface DomainHtmlExportOptions extends HtmlRenderOptions, DomainCompositionOptions { lang?: 'zh' | 'en'; resourceHints?: LegacyResourceHints }
export interface DomainMarkdownExportOptions extends MarkdownRenderOptions, DomainCompositionOptions { lang?: 'zh' | 'en'; exportedAt?: string; resourceHints?: LegacyResourceHints }

/** Orchestrate composition, resources and UI options without an intermediate conversation model. */
export async function exportDomainHtml(conversation: DomainConversationDetail, options: DomainHtmlExportOptions = {}): Promise<string> {
    const { document } = composeDomainDocument(conversation, options);
    const resources = await prepareDomainResources(conversation, options.resourceHints);
    return renderDocumentHtml(document, resources, {
        locale: options.locale ?? options.lang ?? 'zh', theme: options.theme ?? 'dark',
        copyCode: options.copyCode, foldLongPrompts: options.foldLongPrompts, thoughtInitiallyCollapsed: options.thoughtInitiallyCollapsed,
    }).html;
}

export async function exportDomainMarkdown(conversation: DomainConversationDetail, options: DomainMarkdownExportOptions = {}): Promise<string> {
    const { document } = composeDomainDocument(conversation, options);
    const resources = await prepareDomainResources(conversation, options.resourceHints);
    const createdAt = toIso(conversation.createdAt ?? conversation.timestamp ?? conversation.chatTime);
    const updatedAt = toIso(conversation.updatedAt ?? conversation.lastSeen);
    return renderDocumentMarkdown(document, resources, { locale: options.locale ?? options.lang,
        thoughtInitiallyCollapsed: options.thoughtInitiallyCollapsed, frontMatter: options.frontMatter ?? [
            { key: 'title', value: document.header.title }, { key: 'id', value: conversation.id }, { key: 'provider', value: conversation.providerId },
            ...(conversation.url || conversation.href ? [{ key: 'url', value: conversation.url || conversation.href! }] : []),
            ...(createdAt ? [{ key: 'date', value: createdAt }] : []), ...(updatedAt ? [{ key: 'updated', value: updatedAt }] : []),
            { key: 'exported', value: options.exportedAt ?? new Date().toISOString() }, { key: 'tags', value: [`${conversation.providerId}-export`] },
        ] });
}
