import type { DocumentAst } from '../src/core/document/ast/ast.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';

import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';

import { renderDocumentTypst } from '../src/core/renderers/typst/renderTypst.js';
import type { PdfCompileContext, TypstRenderPayload } from '../src/core/export/pdf/pdfCompiler.js';

function rendererBoundary(semantic: DomainConversationWithDetail): void {
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
    // @ts-expect-error DOM anchors belong to the HTML backend.
    document.messages[0].anchor = 'turn';
    // Provider-authored model labels are format-neutral presentation facts.
    document.messages[0].modelLabel = 'model';
    // @ts-expect-error Notes have no production Domain composition source.
    document.messages[0].blocks.push({ type: 'note', title: 'note' });
    // @ts-expect-error Diagnostics are side-channel results, never document facts.
    document.diagnostics = [];
    // @ts-expect-error Diagnostics are not message facts.
    document.messages[0].diagnostics = [];
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


import { compileDocumentPdf } from '../src/core/export/pdf/compileDocumentPdf.js';
function pdfFormatBoundary(domain: DomainConversationWithDetail): void {
    // @ts-expect-error PDF Format receives an already composed document, never Domain.
    compileDocumentPdf(domain, {}, new Map(), {} as never, {} as never);
}
void pdfFormatBoundary;

// @ts-expect-error Diagnostic types live in the independent diagnostics module.
import type { Diagnostic } from '../src/core/document/ast/ast.js';
void (null as unknown as Diagnostic);

import type { MarkdownRenderOptions } from '../src/core/renderers/shared/renderOptions.js';
// @ts-expect-error Renderer options cannot supply metadata that bypasses Document AST.
const metadataBypass: MarkdownRenderOptions = { frontMatter: [{ key: 'title', value: 'stale' }] };
void metadataBypass;


import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';
type ResolveExportRecordStatusOptions = Pick<DomainConversationDetail, 'quality'>;
// @ts-expect-error Diagnostic descriptions are reporting data, not export-integrity evidence.
const diagnosticStatusInput: ResolveExportRecordStatusOptions = { quality: { status: 'unknown', diagnostics: ['warning'] } };
void diagnosticStatusInput;
