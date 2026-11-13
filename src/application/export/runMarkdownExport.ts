import { renderDocumentMarkdown } from '../../l4/format/markdown/renderMarkdown.js';
import { executeExportWithSession, type ExportFormatRendererSession, type ExportRunOptions } from './exportPipeline.js';
import type { ExportRequest, ExportResult } from './types.js';

function createMarkdownOnlyRendererSession(): ExportFormatRendererSession {
    return {
        async render(input) {
            if (input.format !== 'markdown') {
                throw new TypeError(`Markdown export pipeline received unsupported format: ${input.format}`);
            }
            return {
                content: renderDocumentMarkdown(input.document, input.resources, {
                    locale: input.locale,
                    resourceFailures: input.failures,
                }),
            };
        },
    };
}

/** Narrow Markdown-only export entrypoint for Background Service Worker Live Save.
 * Physically excludes DOCX, HTML, Typst/PDF and DOM/WASM dependencies from the Worker bundle.
 */
export async function runMarkdownExport(
    request: ExportRequest & { format: 'markdown' },
    options: ExportRunOptions = {},
): Promise<ExportResult> {
    return executeExportWithSession(request, createMarkdownOnlyRendererSession, options);
}
