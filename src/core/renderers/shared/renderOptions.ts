import type { Diagnostic } from '../../diagnostics/diagnostic.js';
import type { PdfLayoutPolicy } from '../typst/transport.js';

/** Output controls travel beside the document, not inside its JSON tree. */
export interface RenderOptions {
    locale?: 'zh' | 'en';
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
