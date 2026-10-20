import type { Diagnostic } from '../../src/shared/diagnostics/diagnostic.js';
import type { DocumentAst } from '../../src/l3b/ast/ast.js';
import type { ResourceBindings } from '../../src/l4/packaging/resourceBindings.js';
import type { RendererOptions } from '../../src/l4/format/shared/renderOptions.js';
import { renderDocumentTypstCore } from '../../src/l4/format/typst/renderTypstCore.js';

/** Test-only technical hook: public renderDocumentTypst accepts locale alone. */
type FixtureOptions = RendererOptions & {
    convertMath?: (source: string, display: boolean) => string | undefined;
    onDiagnostic?: (diagnostic: Diagnostic) => void;
};

export function renderTypstFixture(document: DocumentAst, resources: ResourceBindings = {}, options: FixtureOptions = {}) {
    const diagnostics: Diagnostic[] = [];
    const payload = renderDocumentTypstCore(document, resources, { locale: options.locale }, {
        convertMath: options.convertMath,
        onDiagnostic(diagnostic) {
            diagnostics.push(diagnostic);
            options.onDiagnostic?.(diagnostic);
        },
    });
    return { payload, diagnostics };
}
