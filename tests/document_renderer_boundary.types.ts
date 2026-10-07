import type { DocumentAst } from '../src/core/export/document/ast.js';
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


function neutralContract(document: DocumentAst): void {
    // @ts-expect-error Physical print policies belong to PDF render options.
    document.pdfLayout = {};
    // @ts-expect-error UI locale cannot be mistaken for the content language.
    document.locale = 'en';
    // @ts-expect-error Theme changes do not require recomposing the logical document.
    document.theme = 'light';
    // @ts-expect-error GFM envelope is a Markdown backend option.
    document.frontMatter = [];
    // @ts-expect-error Common documents are not tied to an output format.
    document.profile = { id: 'pdf', version: 1 };
}
void neutralContract;


import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
import type { ResourceStageInput, PayloadStageInput, CompileStageInput } from '../src/core/export/pdf/pipeline/types.js';
function pdfPipelineBoundary(domain: DomainConversationDetail): void {
    // @ts-expect-error PDF resources must receive an already composed Document AST.
    const resources: ResourceStageInput = { document: domain, resources: new Map() };
    // @ts-expect-error PDF payload generation cannot reinterpret Domain content.
    const payload: PayloadStageInput = { document: domain, pathMap: new Map(), locale: 'en' };
    // @ts-expect-error Compile stage no longer accepts a source conversation.
    const compile: CompileStageInput = { bundle: domain };
    void resources; void payload; void compile;
}
void pdfPipelineBoundary;
