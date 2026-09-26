/**
 * src/core/export/pdf/pdfExporter.ts
 *
 * D7 M5: PDF export orchestration — batch driver over the frozen D7 pipeline.
 *
 * Each item runs the full S1->S5 pipeline (project -> resources -> payload ->
 * compile -> deliver) through PdfPipeline.runOne. The deliver stage lands the
 * PDF through IExportWriter with the staged/finalized batch-ZIP semantics:
 * folder mode — writeFile() resolving IS delivery; ZIP mode — the stage only
 * STAGES into the shared writer and the driver runs the single
 * finalizeZipDelivery() (one generateBlob + downloadHandler) at the end of
 * the batch, then flips staged items to delivered.
 *
 * User iron rules enforced here:
 * - Success is ONLY marked after the artifact is actually delivered:
 *   folder writer — the moment writeFile() resolves (file is on disk);
 *   ZIP writer — only after generateBlob() + downloadHandler() resolve.
 *   A ZIP writeFile() merely STAGES into the in-memory ZIP area; staged
 *   items are never reported successful and no success records are
 *   committed before finalize+delivery (report §1).
 *   downloadHandler is REQUIRED in ZIP mode: without it the blob can never
 *   reach the user, so a missing handler is a configuration error and fails
 *   the batch up front — it is never silently counted as delivered.
 * - One failed item never aborts the batch; failures stay retryable and
 *   are never marked successful.
 * - Cancellation is real: the pipeline's AbortSignal stops stages promptly,
 *   no partial file is written, the batch stops, and every item that never
 *   reached a terminal state is reported as failed (retryable) — nothing
 *   silently dropped.
 * - Nothing is lost quietly: warning/error diagnostics from normalize /
 *   pipeline stages / write are surfaced through onLog (which feeds the
 *   extension Error page) and returned in the result; a failed export-record
 *   write keeps the artifact successful but emits EXPORT_RECORD_WRITE_FAILED.
 * - The result carries UI-contract aliases (failedChats/landedChats/
 *   exportedCount) so the options-page summary, failure banner and retry
 *   flow see PDF failures instead of counting everything successful.
 * - The #584 discriminated union is honored: a 'staged' result carries NO
 *   writeReport (staged is not delivery proof). The batch driver builds the
 *   real writeReport for flipped items only after finalizeZipDelivery
 *   resolves; `if (result.writeReport)` misuse stays a compile error.
 *
 * Engine shape mirrors ExportOrchestrator (run/abort) so
 * exportController can route `format === 'pdf'` here without changes
 * to the progress/cancel UI wiring.
 */

import type {
    ArtifactWriteReport,
    RenderDiagnostic,
} from '../canonical/rendering.js';
import type { Diagnostic } from '../canonical/diagnostics.js';
import { normalizeGeminiConversation } from '../canonical/normalizeGemini.js';
import { createWriter, type IExportWriter } from '../../engine/writers/writerInterface.js';
import { buildExportFileName, normId } from '../../utils/pathUtils.js';
import { DEFAULT_EXPORT_FOLDER_NAME } from '../../utils/constants.js';
import { IPdfCompiler, StubPdfCompiler } from './pdfCompiler.js';
import { PdfPipeline } from './pipeline/orchestrator.js';
import { projectStage } from './pipeline/projectionStage.js';
import { resourceStage } from './pipeline/resourceStage.js';
import { payloadStage } from './pipeline/payloadStage.js';
import { compileStage } from './pipeline/compileStage.js';
import { deliverStage, finalizeZipDelivery } from './pipeline/deliveryStage.js';
import {
    resolveLocalFonts,
    type LocalFontResolution,
} from '../typst/fonts/localFontProvider.js';
import type {
    PipelineItemInput,
    PipelineStages,
    StageContext,
} from './pipeline/types.js';

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
    /**
     * UI-contract aliases (additive): the options-page summary, failure
     * banner and retry flow read failedChats/landedChats/exportedCount.
     * Without these, PDF failures would be invisible to that UI (every item
     * would look successful and retry would find nothing).
     */
    failedChats?: PdfExportItemResult[];
    landedChats?: number;
    exportedCount?: number;
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
    /** Defaults to StubPdfCompiler. M6 injects the real Typst sandbox compiler here. */
    compiler?: IPdfCompiler;
    /** Injected for tests; otherwise created from useZip/dirHandle. */
    writer?: IExportWriter;
    /**
     * REQUIRED when useZip is true. The ZIP is only "delivered" once this
     * handler actually runs — a missing handler is a configuration error and
     * fails the batch (never silently counted as delivered).
     */
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

/** The five frozen D7 stage implementations, wired into the orchestrator. */
const D7_STAGES: PipelineStages = {
    project: projectStage,
    resources: resourceStage,
    payload: payloadStage,
    compile: compileStage,
    deliver: deliverStage,
};

export class PdfExporter {
    aborted = false;
    private _abortController: AbortController | null = null;
    private _compiler: IPdfCompiler;

    constructor(compiler?: IPdfCompiler) {
        this._compiler = compiler ?? new StubPdfCompiler();
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

        this.aborted = false;
        this._abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
        // The pipeline requires a real AbortSignal; in the pathological
        // no-AbortController environment the `aborted` flag still drives the
        // per-item loop breaks below.
        const signal: AbortSignal =
            this._abortController?.signal ?? new AbortController().signal;

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
        // ZIP transaction boundary (report §1): entries staged into the ZIP
        // writer are NOT success yet. Final success is committed only after
        // finalizeZipDelivery() (single generateBlob + downloadHandler)
        // resolves. A staged item carries no writeReport — the driver builds
        // the real delivery proof at flip time.
        const staged: Array<{ id: string; title: string; diagnostics: RenderDiagnostic[] }> = [];
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
            completed.add(id);
            surfaceDiagnostics(id, title, diagnostics);
        };

        /**
         * Warning/error diagnostics must reach the visible log channel
         * (which feeds the extension Error page) — never swallowed.
         * Info-level diagnostics stay in the result only, to avoid spam.
         */
        const surfaceDiagnostics = (id: string, title: string, diagnostics: RenderDiagnostic[]): void => {
            for (const d of diagnostics) {
                if (d.severity === 'warning' || d.severity === 'error') {
                    // Map onto the onLog channel convention ('warn', not 'warning').
                    onLog(`[PDF] ${title || id} ${d.severity}: [${d.code}] ${d.message}`, d.severity === 'warning' ? 'warn' : 'error');
                }
            }
        };

        /**
         * §11: persist the export record. A record-write failure must NOT
         * flip the artifact to failed (the file was delivered) — but it must
         * be LOUD: a visible warning + an EXPORT_RECORD_WRITE_FAILED
         * diagnostic, never a silent catch.
         */
        const commitRecord = async (id: string, record: any, diagnostics: RenderDiagnostic[]): Promise<void> => {
            try {
                await onItemExported(id, record);
            } catch (e: any) {
                const rmsg = e?.message || String(e);
                diagnostics.push({
                    severity: 'warning',
                    code: 'EXPORT_RECORD_WRITE_FAILED',
                    message:
                        `Export record persistence failed for ${id}: ${rmsg}. ` +
                        `The file itself was delivered successfully; the record can be rebuilt on retry.`,
                    path: id,
                });
            }
        };

        /** Terminal-state tracker: every item that reached succeeded/failed. */
        const completed = new Set<string>();

        let wasAborted = false;
        const buildResult = (): PdfExportResult => ({
            total,
            succeeded,
            failed,
            aborted: wasAborted,
            // UI-contract aliases so the summary/banner/retry flow sees PDF failures.
            failedChats: failed,
            landedChats: succeeded,
            exportedCount: succeeded,
        });

        if (total === 0) {
            return buildResult();
        }

        // ZIP delivery contract: a ZIP is only "delivered" when
        // downloadHandler actually runs. Without a handler the blob can never
        // reach the user, so ZIP mode without one is a configuration error —
        // fail every item (retryable, logged) instead of silently counting
        // staged items as delivered. Fail fast, before any compile/write work.
        if (useZip && typeof options.downloadHandler !== 'function') {
            const msg =
                'zip export requires downloadHandler: without it the ZIP blob can never be delivered to the user';
            for (const it of items) failItem(it.id, it.title, msg, []);
            return buildResult();
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
            return buildResult();
        }

        const activeWriter: IExportWriter = writer;

        // Local fonts are resolved once per batch (best-effort): the compile
        // stage forwards their diagnostics and falls back to bundled fonts,
        // so a resolution failure degrades loudly instead of failing items.
        let fonts: LocalFontResolution;
        try {
            fonts = await resolveLocalFonts();
        } catch (e: any) {
            const msg = e?.message || String(e);
            onLog(`[PDF] 本地字体解析失败，已回退到内置字体: ${msg}`, 'warn');
            fonts = {
                fonts: [],
                diagnostics: [
                    {
                        severity: 'warning',
                        code: 'TYPST_LOCAL_FONTS_QUERY_FAILED',
                        message: `resolveLocalFonts threw: ${msg}; falling back to bundled fonts`,
                    },
                ],
                fallbackChain: [],
                localFontsAvailable: false,
            };
        }

        const pipeline = new PdfPipeline(D7_STAGES);

        for (let i = 0; i < items.length; i++) {
            const { id, title } = items[i];
            if (this.aborted || signal.aborted) break;
            report(i, title);

            const chat =
                (Array.isArray(options.conversations)
                    ? options.conversations.find((c: any) => normId(c?.id) === normId(id))
                    : null) ?? (typeof selected[i] === 'object' ? selected[i] : { id, title });

            const itemDiagnostics: RenderDiagnostic[] = [];
            try {
                // S0: normalize the repo conversation -> canonical bundle.
                // The normalizer owns a per-run byte store; S2 consumes it.
                const { bundle, diagnostics, byteStore } = await normalizeGeminiConversation(chat as any);
                for (const d of diagnostics) itemDiagnostics.push(toRenderDiagnostic(d));

                // S1->S5: the frozen D7 pipeline. runOne never throws for
                // item-level failures (they come back as 'failed'); an abort
                // comes back as 'aborted' and is never converted to failure.
                const itemInput: PipelineItemInput = {
                    conversationId: id,
                    title,
                    bundle,
                    byteStore,
                    locale,
                    compiler,
                    fonts,
                    useZip,
                    writer: activeWriter,
                    downloadHandler: options.downloadHandler,
                    folderName,
                };
                const result = await pipeline.runOne(itemInput, {
                    signal,
                    reportProgress: (stage, current, ptotal) => {
                        const frac = ptotal > 0 ? current / ptotal : 0;
                        onProgress({
                            current: i + frac,
                            total,
                            pct: Math.round(((i + frac) / total) * 100),
                            title: `${title} (${stage})`,
                        });
                    },
                    log: (message, level) => onLog(message, level),
                });
                for (const d of result.diagnostics) itemDiagnostics.push(d);

                if (this.aborted || signal.aborted) break;

                switch (result.status) {
                    case 'delivered': {
                        // The deliver stage finalized: writeFile() resolved,
                        // so the artifact is REALLY delivered. The writeReport
                        // on a 'delivered' item is the delivery proof.
                        const writeReport: ArtifactWriteReport = result.writeReport;
                        const record = {
                            title,
                            exportedAt: writeReport.writtenAt,
                            format: 'pdf',
                            fileName: writeReport.fileName,
                            bytesWritten: writeReport.bytesWritten,
                            status: 'ok',
                        };
                        succeeded++;
                        completed.add(id);
                        await commitRecord(id, record, itemDiagnostics);
                        surfaceDiagnostics(id, title, itemDiagnostics);
                        onLog(`[PDF] ${title} 导出成功 (${writeReport.fileName})`, 'info');
                        break;
                    }
                    case 'staged': {
                        // ZIP transaction boundary (report §1): the PDF is
                        // staged into the shared in-memory ZIP area. NOT
                        // success — the driver runs finalizeZipDelivery()
                        // once at the end of the batch and flips these.
                        // (No writeReport here by construction: the #584
                        // union makes carrying one a compile error.)
                        staged.push({ id, title, diagnostics: itemDiagnostics });
                        onLog(`[PDF] ${title} 已暂存，等待 ZIP 打包交付后确认`, 'info');
                        break;
                    }
                    case 'failed':
                        failItem(
                            id,
                            title,
                            `[${result.error.stage}:${result.error.code}] ${result.error.message}`,
                            itemDiagnostics,
                        );
                        break;
                    case 'aborted':
                        // Batch-level abort handling below marks every
                        // unfinished item; never convert abort to failure.
                        break;
                }
                if (result.status === 'aborted') break;
            } catch (e: any) {
                // runOne only throws for programmer errors outside the stage
                // contract; map them to a loud retryable item failure.
                if (isAbortError(e) || this.aborted || signal.aborted) break;
                failItem(id, title, `[pipeline:PIPELINE_THREW] ${e?.message || String(e)}`, itemDiagnostics);
            }
            report(i + 1, title);
        }

        wasAborted = this.aborted || signal.aborted;

        // ZIP transaction boundary (report §1): finalize + deliver FIRST,
        // commit final success records ONLY after the user actually receives
        // the ZIP. A generateBlob/download failure must never leave staged
        // items marked successful — they are reported as failed (retryable).
        // Never package or download after a cancel (user intent); an abort
        // during finalize falls through to the abort branch below.
        if (!wasAborted && useZip && staged.length > 0) {
            const zipFileName = `gemini_export_pdf_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
            const finalizeCtx: StageContext = {
                signal,
                reportProgress: (_s, _c, _t) =>
                    onProgress({ current: total, total, pct: 100, title: '打包 ZIP' }),
                log: (message, level) => onLog(message, level),
            };
            try {
                // downloadHandler was validated up front in ZIP mode; the
                // guard below is unreachable defense-in-depth that stays loud.
                const deliver = options.downloadHandler;
                if (typeof deliver !== 'function') {
                    throw new Error('internal invariant: downloadHandler is required for ZIP delivery');
                }
                const { bytesWritten } = await finalizeZipDelivery(
                    activeWriter,
                    deliver,
                    zipFileName,
                    finalizeCtx,
                );
                // Delivered. Now — and only now — commit final success.
                // The writeReport is built here from the actual delivery
                // (the delivered ZIP), not from the staged per-item report:
                // staged items never carried delivery proof (#584).
                const writtenAt = new Date().toISOString();
                for (const s of staged) {
                    const fileName = buildExportFileName(s.title, s.id, 'pdf');
                    const record = {
                        title: s.title,
                        exportedAt: writtenAt,
                        format: 'pdf',
                        fileName,
                        bytesWritten,
                        status: 'ok',
                    };
                    succeeded++;
                    completed.add(s.id);
                    await commitRecord(s.id, record, s.diagnostics);
                    surfaceDiagnostics(s.id, s.title, s.diagnostics);
                }
                onLog(`[PDF] ZIP 打包交付成功 (${zipFileName})，${staged.length} 个文件确认成功`, 'info');
            } catch (e: any) {
                if (isAbortError(e)) {
                    // Abort during finalize: no package/download completed.
                    // The abort branch below reports unfinished items.
                    wasAborted = true;
                } else {
                    const code = e?.code ? `[${e.code}] ` : '';
                    const msg = `${code}${e?.message || String(e)}`;
                    onLog(`[PDF] ZIP 打包/交付失败: ${msg}；已暂存的 ${staged.length} 个文件不记为成功`, 'error');
                    for (const s of staged) {
                        failed.push({
                            id: s.id,
                            title: s.title,
                            ok: false,
                            error: `zip finalize/delivery failed: ${msg}`,
                            diagnostics: s.diagnostics,
                        });
                        completed.add(s.id);
                        surfaceDiagnostics(s.id, s.title, s.diagnostics);
                    }
                }
            }
        }

        if (wasAborted) {
            // Batch partial-failure semantics on abort: every item that never
            // reached a terminal state is reported as failed (retryable), so
            // a retry covers exactly the unfinished work — nothing is
            // silently dropped, and staged-but-undelivered items are NOT
            // counted as succeeded.
            const stagedById = new Map(staged.map((s) => [s.id, s.diagnostics]));
            for (const it of items) {
                if (!completed.has(it.id)) {
                    completed.add(it.id);
                    failed.push({
                        id: it.id,
                        title: it.title,
                        ok: false,
                        error: 'export aborted before completion (retryable)',
                        diagnostics: stagedById.get(it.id) ?? [],
                    });
                }
            }
            onLog('[PDF] 导出已取消', 'warn');
        }

        try {
            if (typeof activeWriter.close === 'function') await activeWriter.close();
        } catch {
            /* intentional */
        }

        return buildResult();
    }
}

export default PdfExporter;
