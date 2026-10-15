import type { Diagnostic } from '../../src/core/diagnostics/diagnostic.js';
import type { DocumentAst, ResourceBindings } from '../../src/core/document/ast/ast.js';
import type { PdfRenderOptions } from '../../src/core/renderers/shared/renderOptions.js';
import { renderDocumentTypst } from '../../src/core/renderers/typst/renderTypst.js';

/** Collect backend diagnostics without carrying a semantic conversation to the renderer. */
export function renderTypstFixture(document: DocumentAst, resources: ResourceBindings = {}, options: PdfRenderOptions = {}) {
    const diagnostics: Diagnostic[] = [];
    const payload = renderDocumentTypst(document, resources, { ...options, onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
        options.onDiagnostic?.(diagnostic);
    } });
    return { payload, diagnostics };
}
