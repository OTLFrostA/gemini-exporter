/**
 * src/core/export/pdf/pdfExporter.ts
 *
 * P3 PDF export orchestration: single + batch export of conversations to
 * PDF through the frozen IPdfCompiler interface (stub in P3, real Typst
 * compiler in P1b), landing files through IExportWriter.
 *
 * User iron rules enforced here:
 * - Success is ONLY marked after the Writer actually wrote the file
 *   (ArtifactWriteReport). No write, no success. Ever.
 * - One failed item never aborts the batch; failures stay retryable and
 *   are never marked successful.
 * - Cancellation is real: the compile task is aborted via AbortSignal,
 *   no partial file is written, and the batch stops.
 * - Nothing is lost quietly: normalize/compile/write diagnostics are all
 *   surfaced through onLog (which feeds the extension Error page) and
 *   returned in the result.
 *
 * Engine shape mirrors ExportOrchestrator (run/abort) so
 * exportController can route `format === 'pdf'` here without changes
 * to the progress/cancel UI wiring.
 */

import type {
    ArtifactWriteReport,
    CompanionResourcePlan,
    ExportArtifact,
    RenderContext,
    RenderDiagnostic,
    TypstRenderPayload,
} from '../canonical/rendering.js';
import type { Diagnostic } from '../canonical/diagnostics.js';
import { normalizeGeminiConversation } from '../canonical/normalizeGemini.js';
import { createWriter, type IExportWriter } from '../../engine/writers/writerInterface.js';
import { buildExportFileName, normId } from '../../utils/pathUtils.js';
import { DEFAULT_EXPORT_FOLDER_NAME } from '../../utils/constants.js';
import { IPdfCompiler, StubPdfCompiler } from './pdfCompiler.js';

export interface PdfExportItemResult {
    id: string;
    title: string;
    ok: boolean;
    /** Present only when the Writer actually landed the file. */
    fileName?: string;
    bytesWritten?: number;
    /** Machine-readable failure reason; absent on success. */
    error?: string;
    diagnostics: RenderDiagnostic[];
}

export interface PdfExportResult {
    total: number;
    succeeded: number;
    failed: PdfExportItemResult[];
    aborted: boolean;
}

export interface PdfExportProgress {
    current: number;
    total: number;
    pct: number;
    title: string;
}

export interface PdfExporterOptions {
    selected: Array<string | { id: string; title?: string }>;
    /** Full conversation objects for the normalizer; falls back to the selected item itself. */
    conversations?: any[];
    format?: string;
    useZip?: boolean;
    dirHandle?: any;
    folderName?: string;
    /** Defaults to StubPdfCompiler. P1b injects the real compiler here.
     * §15 release gate: the stub is only usable with explicit
     * `allowStub: true` (tests/drills). Production calls without a real
     * compiler throw in run() — never silently produce a placeholder PDF. */
    compiler?: IPdfCompiler;
    /** §15 release gate: explicit opt-in to run the P3 stub compiler.
     * Defaults to false; run() refuses the stub unless this is true. */
    allowStub?: boolean;
    /** Injected for tests; otherwise created from useZip/dirHandle. */
    writer?: IExportWriter;
    downloadHandler?: (blob: Blob, filename: string) => void | Promise<void>;
    locale?: 'zh' | 'en';
}

export interface PdfExporterCallbacks {
    onProgress?: (p: PdfExportProgress) => void;
    onLog?: (msg: string, level?: string) => void;
    onItemExported?: (id: string, record: any) => void;
}

function toRenderDiagnostic(d: Diagnostic): RenderDiagnostic {
    return {
        severity: d.severity,
        code: d.code,
        message: d.message,
        path: d.path,
    };
}

function isAbortError(e: unknown): boolean {
    return (
        (e instanceof DOMException && e.name === 'AbortError') ||
        (typeof e === 'object' && e !== null && (e as any).name === 'AbortError')
    );
}

export class PdfExporter {
    aborted = false;
    private _abortController: AbortController | null = null;
    private _compiler: IPdfCompiler;
    /**
     * §15 release gate: explicit opt-in for the P3 stub compiler.
     * Defaults to false — production must never silently fall back to it.
     */
    private _allowStub: boolean;

    constructor(compiler?: IPdfCompiler, opts?: { allowStub?: boolean }) {
        this._compiler = compiler ?? new StubPdfCompiler();
        this._allowStub = opts?.allowStub ?? false;
    }

    abort(): void {
        this.aborted = true;
        try {
            this._abortController?.abort();
        } catch {
            /* intentional */
        }
    }

    async run(options: PdfExporterOptions, callbacks: PdfExporterCallbacks = {}): Promise<PdfExportResult> {
        const onProgress = callbacks.onProgress ?? (() => {});
        const onLog = callbacks.onLog ?? (() => {});
        const onItemExported = callbacks.onItemExported ?? (() => {});
        const compiler = options.compiler ?? this._compiler;
        const allowStub = options.allowStub ?? this._allowStub ?? false;
        // §15 release gate: StubPdfCompiler produces a placeholder PDF that
        // must never be reported as a successful export on the production
        // path. Refuse loudly; P2 injects the real compiler here.
        if (compiler.name === 'stub-pdf-compiler' && !allowStub) {
            throw new Error(
                '[§15 release gate] StubPdfCompiler 在生产路径被禁用：' +
                '它只会生成占位 PDF，不能记为导出成功。P2 会在这里注入真编译器；' +
                '仅测试/演练可显式传入 { allowStub: true }。'
            );
        }

        this.aborted = false;
        this._abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const signal = this._abortController ? this._abortController.signal : undefined;

        const selected = Array.isArray(options.selected) ? options.selected : [];
        const useZip = options.useZip !== false;
        const locale = options.locale === 'en' ? 'en' : 'zh';
        const folderName = options.folderName || DEFAULT_EXPORT_FOLDER_NAME;

        const items = selected.map((s) => {
            const id = typeof s === 'string' ? s : s?.id;
            const title = (typeof s === 'object' && s?.title) || String(id ?? '');
            return { id: String(id ?? ''), title };
        }).filter((it) => it.id);

        const total = items.length;
        const failed: PdfExportItemResult[] = [];
        let succeeded = 0;
        let writer: IExportWriter | null = options.writer ?? null;

        const report = (current: number, title: string) => {
            onProgress({
                current,
                total,
                pct: total === 0 ? 100 : Math.round((current / total) * 100),
                title,
            });
        };

        const failItem = (id: string, title: string, error: string, diagnostics: RenderDiagnostic[]): void => {
            onLog(`[PDF] ${title || id} 导出失败: ${error}`, 'error');
            failed.push({ id, title, ok: false, error, diagnostics });
        };

        if (total === 0) {
            return { total: 0, succeeded: 0, failed, aborted: false };
        }

        // Writer setup (fail-closed: no writer, no export).
        try {
            if (!writer) {
                if (!useZip && !options.dirHandle) {
                    throw new Error('Directory handle not provided for folder export');
                }
                writer = createWriter(useZip ? 'zip' : 'fs', { dirHandle: options.dirHandle, folderName });
                if (typeof writer.init === 'function' && !useZip) {
                    await writer.init();
                }
            }
        } catch (e: any) {
            const msg = e?.message || String(e);
            onLog(`[PDF] 写入器初始化失败: ${msg}`, 'error');
            for (const it of items) failItem(it.id, it.title, `writer init failed: ${msg}`, []);
            return { total, succeeded: 0, failed, aborted: false };
        }

        const activeWriter: IExportWriter = writer;

        for (let i = 0; i < items.length; i++) {
            const { id, title } = items[i];
            if (this.aborted || signal?.aborted) break;
            report(i, title);

            const chat =
                (Array.isArray(options.conversations)
                    ? options.conversations.find((c: any) => normId(c?.id) === normId(id))
                    : null) ?? (typeof selected[i] === 'object' ? selected[i] : { id, title });

            const itemDiagnostics: RenderDiagnostic[] = [];
            try {
                // 1. Normalize repo conversation -> canonical bundle (F2b).
                const { bundle, diagnostics } = await normalizeGeminiConversation(chat as any);
                for (const d of diagnostics) itemDiagnostics.push(toRenderDiagnostic(d));

                // 2. Build the frozen compile input. P1a will enrich this with
                //    messageHints/convertedMath; the bundle alone is sufficient
                //    for the orchestration contract.
                const payload: TypstRenderPayload = {
                    rendererSchemaVersion: 1,
                    sourceSchemaVersion: 1,
                    bundle,
                };
                const context: RenderContext = {
                    bundle,
                    assets: {
                        // P3: no asset byte resolution yet; every asset is
                        // recorded as omitted (see companion plan below),
                        // never silently dropped.
                        resolve: async () => null,
                    },
                    locale,
                    signal: signal as AbortSignal,
                    reportProgress: (stage, current, ptotal) => {
                        onProgress({
                            current: i + (ptotal > 0 ? current / ptotal : 0),
                            total,
                            pct: Math.round(((i + (ptotal > 0 ? current / ptotal : 0)) / total) * 100),
                            title: `${title} (${stage})`,
                        });
                    },
                };

                // 3. Compile (stub in P3, real Typst compiler in P1b).
                const { pdfBytes, diagnostics: compileDiags } = await compiler.compile(payload, context);
                for (const d of compileDiags) itemDiagnostics.push(d);

                // Cancelled mid-compile: never write a partial file.
                if (this.aborted || signal?.aborted) break;

                // 4. Companion resource plan: stub phase cannot resolve asset
                //    bytes, so every asset is explicitly omitted with a reason
                //    + a warning diagnostic. Loud, not silent.
                const companionPlan: CompanionResourcePlan = {
                    resourceIds: [],
                    omitted: bundle.assets.map((a) => ({
                        resourceId: a.id,
                        reason: 'P3 stub phase: asset bytes not resolved; real resolution lands with P1b/P2',
                    })),
                };
                if (companionPlan.omitted.length > 0) {
                    itemDiagnostics.push({
                        severity: 'warning',
                        code: 'ASSETS_OMITTED_STUB',
                        message: `${companionPlan.omitted.length} asset(s) omitted in stub phase; recorded, not silently dropped.`,
                    });
                }

                const artifact: ExportArtifact = {
                    fileName: buildExportFileName(title, id, 'pdf'),
                    mimeType: 'application/pdf',
                    content: pdfBytes,
                    companionResourceIds: [],
                    companionPlan,
                    diagnostics: itemDiagnostics,
                };

                // 5. Writer is the ONLY thing that can mark success.
                await activeWriter.writeFile(artifact.fileName, artifact.content as Uint8Array);
                const writeReport: ArtifactWriteReport = {
                    fileName: artifact.fileName,
                    target: useZip ? 'zip' : 'folder',
                    bytesWritten: pdfBytes.byteLength,
                    writtenAt: new Date().toISOString(),
                };
                artifact.writeReport = writeReport;

                succeeded++;
                const record = {
                    title,
                    exportedAt: writeReport.writtenAt,
                    format: 'pdf',
                    fileName: artifact.fileName,
                    bytesWritten: writeReport.bytesWritten,
                    status: 'ok',
                };
                try {
                    await onItemExported(id, record);
                } catch {
                    /* intentional: record hook must not fail the export */
                }
                onLog(`[PDF] ${title} 导出成功 (${artifact.fileName})`, 'info');
            } catch (e: any) {
                if (isAbortError(e) || this.aborted || signal?.aborted) break;
                failItem(id, title, e?.message || String(e), itemDiagnostics);
            }
            report(i + 1, title);
        }

        const wasAborted = this.aborted || !!signal?.aborted;

        // ZIP packaging: never package or download after a cancel (user intent).
        if (!wasAborted && useZip && succeeded > 0) {
            try {
                if (typeof activeWriter.generateBlob === 'function') {
                    const blob = await activeWriter.generateBlob((pct: number) =>
                        onProgress({ current: total, total, pct: Math.floor(pct), title: '打包 ZIP' })
                    );
                    const zipFileName = `gemini_export_pdf_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
                    if (options.downloadHandler) {
                        await options.downloadHandler(blob, zipFileName);
                    }
                }
            } catch (e: any) {
                onLog(`[PDF] ZIP 打包失败: ${e?.message || String(e)}`, 'error');
            }
        }

        if (wasAborted) {
            onLog('[PDF] 导出已取消', 'warn');
        }

        try {
            if (typeof activeWriter.close === 'function') await activeWriter.close();
        } catch {
            /* intentional */
        }

        return { total, succeeded, failed, aborted: wasAborted };
    }
}

export default PdfExporter;
