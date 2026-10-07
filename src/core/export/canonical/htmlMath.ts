import { renderMathHtml as renderDocumentMathHtml, type RenderMathHtmlResult } from '../document/htmlMath.js';
import { getRendererStrings } from './rendererStrings.js';

export type { RenderMathHtmlResult } from '../document/htmlMath.js';

/** Compatibility adapter; the backend takes its fallback copy from the display tree. */
export function renderMathHtml(source: string, display: boolean, isEn: boolean): RenderMathHtmlResult {
    return renderDocumentMathHtml(source, display, getRendererStrings(isEn ? 'en' : 'zh').mathFallback);
}
