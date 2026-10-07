import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import type { ResourceBindings } from './ast.js';
import { composeDocument, type CompositionOptions } from './composeDocument.js';

export type HtmlCompositionOptions = CompositionOptions;
export function composeHtmlDocument(bundle: CanonicalConversationBundle, bindings: ResourceBindings, options: HtmlCompositionOptions = {}) {
    return composeDocument(bundle, bindings, 'html', options);
}
