import type { CanonicalConversationBundle } from '../src/core/export/canonical/conversation.js';
import { renderDocumentHtml } from '../src/core/export/document/renderHtml.js';

function rendererBoundary(semantic: CanonicalConversationBundle): void {
    // @ts-expect-error A semantic conversation cannot be sent to the rendering backend.
    renderDocumentHtml(semantic, {});
}
void rendererBoundary;
