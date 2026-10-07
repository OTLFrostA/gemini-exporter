import type { CanonicalConversationBundle } from '../src/core/export/canonical/conversation.js';
import { renderDocumentHtml } from '../src/core/export/document/renderHtml.js';

import { renderDocumentMarkdown } from '../src/core/export/document/renderMarkdown.js';

function rendererBoundary(semantic: CanonicalConversationBundle): void {
    // @ts-expect-error A semantic conversation cannot be sent to the rendering backend.
    renderDocumentHtml(semantic, {});
    // @ts-expect-error Markdown also requires the presentation tree.
    renderDocumentMarkdown(semantic, {});
}
void rendererBoundary;
