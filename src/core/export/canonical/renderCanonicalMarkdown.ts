import type { CanonicalConversationBundle } from './conversation.js';
import { composeMarkdownDocument } from '../document/composeMarkdown.js';
import { isArchiveResourceRef } from '../document/composeDocument.js';
import { renderDocumentMarkdown } from '../document/renderMarkdown.js';

export interface CanonicalMarkdownOptions {
    lang?: 'zh' | 'en';
    exportedAt?: string;
}

/** Compatibility orchestration: prepare archive paths and capture export context. */
export function renderCanonicalMarkdown(bundle: CanonicalConversationBundle, options: CanonicalMarkdownOptions = {}): string {
    const resources = Object.fromEntries(bundle.assets.flatMap(asset => asset.storageRef && isArchiveResourceRef(asset.storageRef) ? [[asset.id, asset.storageRef]] : []));
    const { document } = composeMarkdownDocument(bundle, resources, { ...options, exportedAt: options.exportedAt ?? new Date().toISOString() });
    return renderDocumentMarkdown(document, resources);
}
