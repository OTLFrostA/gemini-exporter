import type { Asset } from '../canonical/assets.js';
import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import type { CompositionOptions } from '../document/composeDocument.js';
import type { PdfRenderOptions } from '../document/renderOptions.js';
import { composeDocument } from '../document/composeDocument.js';
import { renderDocumentTypst } from '../document/renderTypst.js';
import type { DocumentDiagnostic } from '../document/ast.js';
import type { TypstConversationRenderPayload } from './transport.js';

export type { TypstInlineNode, TypstListItem, TypstTableCell, TypstBlockNode, TypstRenderMessage, TypstConversationRenderPayload } from './transport.js';
export type TypstAdapterDiagnostic = DocumentDiagnostic;
export interface TypstPayloadOptions extends PdfRenderOptions, CompositionOptions {
    assetPath(asset: Asset): string | undefined;
}
export interface TypstPayloadResult { payload: TypstConversationRenderPayload; diagnostics: DocumentDiagnostic[] }

/** Compatibility orchestration; neither output backend receives semantic input. */
export function toTypstPayload(bundle: CanonicalConversationBundle, options: TypstPayloadOptions): TypstPayloadResult {
    const resources = Object.fromEntries(bundle.assets.flatMap(asset => {
        const path = options.assetPath(asset);
        return path ? [[asset.id, path]] : [];
    }));
    const { document, diagnostics } = composeDocument(bundle, options);
    return { payload: renderDocumentTypst(document, resources, { locale: options.locale, convertMath: options.convertMath, layout: options.layout, repeatTableHeader: options.repeatTableHeader, onDiagnostic: diagnostic => { diagnostics.push(diagnostic); options.onDiagnostic?.(diagnostic); } }), diagnostics };
}
