import type { DocumentAst, DocumentDiagnostic, ResourceBindings } from '../../src/core/export/document/ast.js';
import type { PdfRenderOptions } from '../../src/core/export/document/renderOptions.js';
import { renderDocumentTypst } from '../../src/core/export/document/renderTypst.js';

/** Collect backend diagnostics without carrying a semantic conversation to the renderer. */
export function renderTypstFixture(document: DocumentAst, resources: ResourceBindings = {}, options: PdfRenderOptions = {}) {
    const diagnostics: DocumentDiagnostic[] = [];
    const payload = renderDocumentTypst(document, resources, { ...options, onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
        options.onDiagnostic?.(diagnostic);
    } });
    return { payload, diagnostics };
}
