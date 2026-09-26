/**
 * src/core/export/pdf/index.ts
 *
 * D7 PDF export feature entry point.
 * The default compiler is the real Typst sandbox compiler (D7 M6);
 * StubPdfCompiler is exported for tests only (behind the allowStub opt-in).
 */

export type { IPdfCompiler, PdfCompileResult, StubPdfCompilerOptions } from './pdfCompiler.js';
export { StubPdfCompiler } from './pdfCompiler.js';
export type {
    PdfExportItemResult,
    PdfExportResult,
    PdfExportProgress,
    PdfExporterOptions,
    PdfExporterCallbacks,
} from './pdfExporter.js';
import { PdfExporter } from './pdfExporter.js';
export { PdfExporter };
export default PdfExporter;
