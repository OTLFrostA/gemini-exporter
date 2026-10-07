import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import type { ResourceBindings } from './ast.js';
import { composeDocument, type CompositionOptions } from './composeDocument.js';

export function composePdfDocument(bundle: CanonicalConversationBundle, bindings: ResourceBindings, options: CompositionOptions = {}) {
    return composeDocument(bundle, bindings, 'pdf', options);
}
