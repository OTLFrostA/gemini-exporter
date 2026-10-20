import type { DocumentAst } from '../../../l3b/ast/ast.js';
import type { ResourceBindings } from '../../packaging/resourceBindings.js';
import type { RendererOptions } from '../shared/renderOptions.js';
import type { TypstConversationRenderPayload } from './transport.js';
import { renderDocumentTypstCore } from './renderTypstCore.js';
export { defaultPdfLayout } from './layout.js';

/** Convert a format-neutral presentation tree using only provided paths and locale. */
export function renderDocumentTypst(
    document: DocumentAst,
    resources: ResourceBindings,
    options: RendererOptions = {},
): TypstConversationRenderPayload {
    return renderDocumentTypstCore(document, resources, options);
}
