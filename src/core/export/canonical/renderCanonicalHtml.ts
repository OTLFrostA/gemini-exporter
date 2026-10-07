import type { CompanionResourcePlan, ExportArtifact } from '../artifacts.js';
import type { Asset } from './assets.js';
import type { CanonicalConversationBundle } from './conversation.js';
import { collectReferencedAssetIds } from './assetReferences.js';
import type { ConversationRenderer, RenderContext, RenderDiagnostic } from './rendering.js';
import { composeDocument, type CompositionOptions } from '../document/composeDocument.js';
import type { HtmlRenderOptions } from '../document/renderOptions.js';
import { renderDocumentHtml } from '../document/renderHtml.js';
import { sanitizeUrl } from '../../engine/template/htmlTemplate.js';

export interface CanonicalHtmlOptions extends HtmlRenderOptions, CompositionOptions {
    lang?: 'zh' | 'en';
    assetUrl?: (asset: Asset) => string | undefined;
}
export interface CanonicalHtmlResult { html: string; diagnostics: RenderDiagnostic[] }

/** Compatibility orchestration seam; the actual renderer consumes only DocumentAst. */
export function renderCanonicalHtml(bundle: CanonicalConversationBundle, options: CanonicalHtmlOptions = {}): CanonicalHtmlResult {
    const resources = Object.fromEntries(bundle.assets.flatMap(asset => {
        const url = options.assetUrl ? options.assetUrl(asset) : asset.storageRef;
        return url ? [[asset.id, url]] : [];
    }));
    const composed = composeDocument(bundle, options);
    const result = renderDocumentHtml(composed.document, resources, { locale: options.locale ?? options.lang, theme: options.theme, thoughtInitiallyCollapsed: options.thoughtInitiallyCollapsed, copyCode: options.copyCode, foldLongPrompts: options.foldLongPrompts });
    return { html: result.html, diagnostics: [...composed.diagnostics, ...result.diagnostics] };
}

export class CanonicalHtmlRenderer implements ConversationRenderer {
    readonly format = 'html' as const;

    constructor(private readonly options: CanonicalHtmlOptions = {}) {}

    async render(context: RenderContext): Promise<ExportArtifact> {
        context.signal.throwIfAborted();
        context.reportProgress('html:collect-assets', 0, 1);

        const messages = context.bundle.conversation.messages;
        const referenced = new Set<string>();
        for (const m of messages) {
            for (const id of collectReferencedAssetIds(m.blocks)) referenced.add(id);
        }

        const urlByAssetId = new Map<string, string>();
        const byId = new Map(context.bundle.assets.map(asset => [asset.id, asset]));
        const omitted: Array<{ resourceId: string; reason: string }> = [];
        for (const assetId of referenced) {
            context.signal.throwIfAborted();
            try {
                const asset = byId.get(assetId);
                if (!asset) {
                    omitted.push({ resourceId: assetId, reason: 'unknown-resource' });
                    continue;
                }
                const resolved = this.options.assetUrl ? null : await context.assets.resolve(assetId);
                const url = this.options.assetUrl && asset
                    ? this.options.assetUrl(asset)
                    : resolved?.renderUrl ?? resolved?.asset.storageRef;
                if (url && sanitizeUrl(url, true) !== '#') {
                    urlByAssetId.set(assetId, url);
                } else {
                    omitted.push({ resourceId: assetId, reason: 'unresolvable' });
                }
            } catch {
                omitted.push({ resourceId: assetId, reason: 'resolve-error' });
            }
        }
        context.signal.throwIfAborted();
        context.reportProgress('html:collect-assets', 1, 1);

        const { html, diagnostics } = renderCanonicalHtml(context.bundle, {
            ...this.options,
            locale: context.locale,
            lang: context.locale,
            assetUrl: (asset) => urlByAssetId.get(asset.id),
        });

        const plan: CompanionResourcePlan = {
            resourceIds: [...urlByAssetId.keys()],
            omitted,
        };
        const rawTitle = context.bundle.conversation.title ?? 'conversation';
        const fileName = `${String(rawTitle).replace(/[\r\n]+/g, ' ').trim().replace(/[^\w\-. ]+/g, '').slice(0, 80) || 'conversation'}.html`;

        return {
            fileName,
            mimeType: 'text/html',
            content: html,
            companionResourceIds: plan.resourceIds,
            companionPlan: plan,
            diagnostics,
        };
    }
}
