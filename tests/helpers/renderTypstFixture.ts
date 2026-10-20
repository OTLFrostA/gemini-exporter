import type { Diagnostic } from '../../src/shared/diagnostics/diagnostic.js';
import type { DocumentAst } from '../../src/l3b/ast/ast.js';
import type { ResourceBindings } from '../../src/l4/packaging/resourceBindings.js';
import type { PdfRenderOptions } from '../../src/l4/format/shared/renderOptions.js';
import { renderDocumentTypst } from '../../src/l4/format/typst/renderTypst.js';

/** Collect backend diagnostics without carrying a semantic conversation to the renderer. */
export function renderTypstFixture(document: DocumentAst, resources: ResourceBindings = {}, options: PdfRenderOptions = {}) {
    const diagnostics: Diagnostic[] = [];
    const payload = renderDocumentTypst(document, resources, { ...options, onDiagnostic(diagnostic) {
        diagnostics.push(diagnostic);
        options.onDiagnostic?.(diagnostic);
    } });
    return { payload, diagnostics };
}
