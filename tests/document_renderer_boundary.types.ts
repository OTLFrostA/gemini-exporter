import type { CanonicalConversationBundle } from '../src/core/export/canonical/conversation.js';
import { renderDocumentHtml } from '../src/core/export/document/renderHtml.js';

import { renderDocumentMarkdown } from '../src/core/export/document/renderMarkdown.js';

import { renderDocumentTypst } from '../src/core/export/document/renderTypst.js';
import type { PdfCompileContext, TypstRenderPayload } from '../src/core/export/pdf/pdfCompiler.js';

function rendererBoundary(semantic: CanonicalConversationBundle): void {
    // @ts-expect-error A semantic conversation cannot be sent to the rendering backend.
    renderDocumentHtml(semantic, {});
    // @ts-expect-error Markdown also requires the presentation tree.
    renderDocumentMarkdown(semantic, {});
    // @ts-expect-error Typst consumes the same presentation tree, never semantic facts.
    renderDocumentTypst(semantic, {});
    // @ts-expect-error Compiler wire payload cannot carry the source conversation.
    const compilerPayload: TypstRenderPayload = { bundle: semantic };
    // @ts-expect-error Compiler context cannot carry the source conversation.
    const compilerContext: PdfCompileContext = { bundle: semantic };
    void compilerPayload; void compilerContext;
}
void rendererBoundary;
