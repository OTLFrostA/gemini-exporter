import type { Asset } from '../canonical/assets.js';
import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import { composePdfDocument } from '../document/composePdf.js';
import { renderDocumentTypst } from '../document/renderTypst.js';
import type { DocumentDiagnostic } from '../document/ast.js';
import type { TypstConversationRenderPayload } from './transport.js';

export type { TypstInlineNode, TypstListItem, TypstTableCell, TypstBlockNode, TypstRenderMessage, TypstConversationRenderPayload } from './transport.js';
export type TypstAdapterDiagnostic = DocumentDiagnostic;
export interface TypstPayloadOptions {
    assetPath(asset: Asset): string | undefined;
    convertMath?: (source: string, display: boolean) => string | undefined;
    locale?: 'zh' | 'en';
}
export interface TypstPayloadResult { payload: TypstConversationRenderPayload; diagnostics: DocumentDiagnostic[] }

/** Compatibility orchestration; neither output backend receives semantic input. */
export function toTypstPayload(bundle: CanonicalConversationBundle, options: TypstPayloadOptions): TypstPayloadResult {
    const resources = Object.fromEntries(bundle.assets.flatMap(asset => {
        const path = options.assetPath(asset);
        return path ? [[asset.id, path]] : [];
    }));
    const { document, diagnostics } = composePdfDocument(bundle, resources, { lang: options.locale });
    return { payload: renderDocumentTypst(document, resources, options.convertMath), diagnostics };
}
