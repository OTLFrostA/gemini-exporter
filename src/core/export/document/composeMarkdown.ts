import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import type { ResourceBindings } from './ast.js';
import { composeDocument, type CompositionOptions } from './composeDocument.js';

export interface MarkdownCompositionOptions extends CompositionOptions { exportedAt: string }
export function composeMarkdownDocument(bundle: CanonicalConversationBundle, bindings: ResourceBindings, options: MarkdownCompositionOptions) {
    return composeDocument(bundle, bindings, 'markdown', options);
}
