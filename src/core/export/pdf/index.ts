/**
 * src/core/export/pdf/index.ts
 *
 * P3 PDF export feature entry point.
 * The real Typst compiler (P1b) implements IPdfCompiler and injects it;
 * P3 ships with the deterministic StubPdfCompiler for tests/UI wiring.
 */

export type { IPdfCompiler, PdfCompileResult, StubPdfCompilerOptions } from './pdfCompiler.js';
export { StubPdfCompiler, buildMinimalValidPdf } from './pdfCompiler.js';
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
