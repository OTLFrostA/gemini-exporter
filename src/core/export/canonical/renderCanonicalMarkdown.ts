import type { CanonicalConversationBundle } from './conversation.js';
import type { CompositionOptions } from '../document/composeDocument.js';
import type { MarkdownRenderOptions } from '../document/renderOptions.js';
import { composeDocument } from '../document/composeDocument.js';
import { isArchiveResourceRef } from '../document/composeDocument.js';
import { renderDocumentMarkdown } from '../document/renderMarkdown.js';

export interface CanonicalMarkdownOptions extends MarkdownRenderOptions, CompositionOptions {
    lang?: 'zh' | 'en';
    exportedAt?: string;
}

/** Compatibility orchestration: prepare archive paths and capture export context. */
export function renderCanonicalMarkdown(bundle: CanonicalConversationBundle, options: CanonicalMarkdownOptions = {}): string {
    const resources = Object.fromEntries(bundle.assets.flatMap(asset => asset.storageRef && isArchiveResourceRef(asset.storageRef) ? [[asset.id, asset.storageRef]] : []));
    const { document } = composeDocument(bundle, options);
    const conversation = bundle.conversation;
    return renderDocumentMarkdown(document, resources, { locale: options.locale ?? options.lang, thoughtInitiallyCollapsed: options.thoughtInitiallyCollapsed, frontMatter: options.frontMatter ?? [
        { key: 'title', value: document.header.title }, { key: 'id', value: conversation.key.conversationId }, { key: 'provider', value: conversation.key.providerId },
        ...(conversation.url ? [{ key: 'url', value: conversation.url }] : []),
        ...(conversation.createdAt ? [{ key: 'date', value: conversation.createdAt }] : []),
        ...(conversation.updatedAt ? [{ key: 'updated', value: conversation.updatedAt }] : []),
        { key: 'exported', value: options.exportedAt ?? new Date().toISOString() }, { key: 'tags', value: [`${conversation.key.providerId}-export`] },
    ] });
}
