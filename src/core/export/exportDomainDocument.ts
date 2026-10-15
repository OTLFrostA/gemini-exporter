import type { ResourceResult, ResourceDelivery } from '../resources/resourceResult.js';
import type { TrustedDomain } from '../domain/runtimeValidation.js';
import { composeDomainDocument, type DomainCompositionOptions } from '../document/compose/composeDomainDocument.js';
import { prepareDomainResources } from './assets/prepareDomainResources.js';
import { renderDocumentHtml } from '../renderers/html/renderHtml.js';
import { renderDocumentMarkdown } from '../renderers/markdown/renderMarkdown.js';
import type { HtmlRenderOptions, MarkdownRenderOptions } from '../renderers/shared/renderOptions.js';

export interface DomainHtmlExportOptions extends HtmlRenderOptions, DomainCompositionOptions { lang?: 'zh' | 'en'; resourceResults?: readonly ResourceResult<ResourceDelivery>[] }
export interface DomainMarkdownExportOptions extends MarkdownRenderOptions, DomainCompositionOptions { lang?: 'zh' | 'en'; exportedAt?: string; resourceResults?: readonly ResourceResult<ResourceDelivery>[] }

/** Orchestrate composition, resources and UI options without an intermediate conversation model. */
export async function exportDomainHtml(conversation: TrustedDomain, options: DomainHtmlExportOptions = {}): Promise<string> {
    const { document } = composeDomainDocument(conversation, options);
    const resources = prepareDomainResources(options.resourceResults);
    return renderDocumentHtml(document, resources, {
        locale: options.locale ?? options.lang ?? 'zh', theme: options.theme ?? 'dark',
        copyCode: options.copyCode, foldLongPrompts: options.foldLongPrompts, thoughtInitiallyCollapsed: options.thoughtInitiallyCollapsed,
    }).html;
}

export async function exportDomainMarkdown(conversation: TrustedDomain, options: DomainMarkdownExportOptions = {}): Promise<string> {
    const { document } = composeDomainDocument(conversation, options);
    const resources = prepareDomainResources(options.resourceResults);
    return renderDocumentMarkdown(document, resources, { locale: options.locale ?? options.lang,
        thoughtInitiallyCollapsed: options.thoughtInitiallyCollapsed, includeFrontMatter: options.includeFrontMatter ?? true,
        exportedAt: options.exportedAt ?? new Date().toISOString() });
}
