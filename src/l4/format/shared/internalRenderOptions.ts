import type { Diagnostic } from '../../../shared/diagnostics/diagnostic.js';
import type { PdfLayoutPolicy } from '../typst/transport.js';
import type { RendererOptions } from './renderOptions.js';

/** L4 implementation-only legacy controls; not part of the frozen public renderer options. */
export interface RenderOptions extends RendererOptions {
    theme?: 'dark' | 'light';
    thoughtInitiallyCollapsed?: boolean;
    showCodeHeader?: boolean;
}
export interface HtmlRenderOptions extends RenderOptions {
    copyCode?: boolean;
    foldLongPrompts?: boolean;
}
export interface MarkdownRenderOptions extends RenderOptions {
    includeFrontMatter?: boolean;
    exportedAt?: number;
}
export interface PdfRenderOptions extends RenderOptions {
    convertMath?: (source: string, display: boolean) => string | undefined;
    layout?: PdfLayoutPolicy;
    repeatTableHeader?: boolean;
    onDiagnostic?: (diagnostic: Diagnostic) => void;
}
