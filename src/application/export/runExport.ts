import type { Diagnostic } from '../../shared/diagnostics/diagnostic.js';
import { missingResource } from '../../shared/resources/resourceResult.js';
import { renderDocumentMarkdown } from '../../l4/format/markdown/renderMarkdown.js';
import { renderDocumentHtml } from '../../l4/format/html/renderHtml.js';
import { renderDocumentDocx } from '../../l4/format/docx/renderDocx.js';
import { serializeDomainJson } from '../../l4/format/json/serializeDomainJson.js';
import { compileDocumentPdf } from '../../l4/format/pdf/compileDocumentPdf.js';
import { TypstSandboxCompiler } from '../../l4/format/pdf/typst/typstSandboxCompiler.js';
import { resolveLocalFonts } from '../../l4/format/pdf/typst/fonts/localFontProvider.js';
import { mountRuntimeFonts } from '../../l4/format/pdf/typst/fonts/mountRuntimeFonts.js';
import { executeExportWithSession, shouldSkipExport, type ExportFormatRendererSession, type ExportRunOptions } from './exportPipeline.js';
import type { ExportRequest, ExportResult } from './types.js';

export { shouldSkipExport };

function createFullFormatRendererSession(): ExportFormatRendererSession {
    let compiler: TypstSandboxCompiler | undefined;
    let fontDiagnostics: readonly Diagnostic[] = [];
    return {
        async render(input) {
            const renderOptions = { locale: input.locale, resourceFailures: input.failures };
            switch (input.format) {
                case 'json':
                    return { content: serializeDomainJson(input.conversation, input.account, input.resources) };
                case 'markdown':
                    return { content: renderDocumentMarkdown(input.document, input.resources, renderOptions) };
                case 'docx':
                    return { content: await renderDocumentDocx(input.document, input.resources, input.prepared, renderOptions) };
                case 'html': {
                    const html = renderDocumentHtml(input.document, input.resources, renderOptions);
                    for (const diagnostic of html.diagnostics) input.diagnose({ key: input.key, stage: 'html', ...diagnostic });
                    return {
                        content: html.html,
                        otherContentMissing: html.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED'),
                    };
                }
                case 'pdf': {
                    if (!compiler) {
                        compiler = new TypstSandboxCompiler();
                        fontDiagnostics = (await mountRuntimeFonts(await resolveLocalFonts(), compiler)).effectiveFonts.diagnostics;
                    }
                    for (const diagnostic of fontDiagnostics) input.diagnose({ key: input.key, stage: 'pdf', ...diagnostic });
                    const pdf = await compileDocumentPdf(input.document, input.resources, input.prepared, compiler,
                        { signal: input.signal, reportProgress() {} }, renderOptions);
                    for (const diagnostic of pdf.diagnostics) {
                        input.diagnose({ key: input.key, stage: 'pdf', ...diagnostic });
                        if (diagnostic.code === 'FORMAT_CONTENT_OMITTED' && diagnostic.path?.startsWith('asset:')) {
                            const id = diagnostic.path.slice(6);
                            input.failures[id] = missingResource(id, diagnostic.message, 'RESOURCE_PROCESSING_FAILED');
                        }
                    }
                    return {
                        content: pdf.pdfBytes,
                        otherContentMissing: pdf.diagnostics.some(d => d.code === 'FORMAT_CONTENT_OMITTED' && !d.path?.startsWith('asset:')),
                    };
                }
            }
        },
        dispose() {
            compiler?.dispose();
        },
    };
}

/** Full five-format interactive export entrypoint for Options and Popup. */
export async function runExport(request: ExportRequest, options: ExportRunOptions = {}): Promise<ExportResult> {
    return executeExportWithSession(request, createFullFormatRendererSession, options);
}
