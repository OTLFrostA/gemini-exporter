/**
 * src/core/export/pdf/pdfExporter.ts
 *
 * P3 PDF export orchestration: single + batch export of conversations to
 * PDF through the frozen IPdfCompiler interface (stub in P3, real Typst
 * compiler in P1b), landing files through IExportWriter.
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
 * - Cancellation is real: the compile task is aborted via AbortSignal,
 *   no partial file is written, the batch stops, and every item that never
 *   reached a terminal state is reported as failed (retryable) — nothing
 *   silently dropped.
 * - Nothing is lost quietly: warning/error diagnostics from normalize /
 *   compile / write are surfaced through onLog (which feeds the extension
 *   Error page) and returned in the result; a failed export-record write
 *   keeps the artifact successful but emits EXPORT_RECORD_WRITE_FAILED.
 * - The result carries UI-contract aliases (failedChats/landedChats/
 *   exportedCount) so the options-page summary, failure banner and retry
 *   flow see PDF failures instead of counting everything successful.
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
    /** Defaults to StubPdfCompiler. P1b injects the real compiler here. */
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
        // ZIP transaction boundary (report §1): entries staged into the ZIP
        // writer are NOT success yet. Final success is committed only after
        // generateBlob() + downloadHandler() both resolve.
        const staged: Array<{ id: string; title: string; record: any; diagnostics: RenderDiagnostic[] }> = [];
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

                const record = {
                    title,
                    exportedAt: writeReport.writtenAt,
                    format: 'pdf',
                    fileName: artifact.fileName,
                    bytesWritten: writeReport.bytesWritten,
                    status: 'ok',
                };
                if (useZip) {
                    // ZIP transaction boundary (report §1): writeFile() only
                    // stages the PDF into the in-memory ZIP area. It is NOT
                    // success — final success is committed only after
                    // generateBlob() + downloadHandler() both resolve below.
                    staged.push({ id, title, record, diagnostics: itemDiagnostics });
                    onLog(`[PDF] ${title} 已暂存 (${artifact.fileName})，等待 ZIP 打包交付后确认`, 'info');
                } else {
                    // Folder writer: the file is on disk the moment
                    // writeFile() resolves — that IS delivery.
                    succeeded++;
                    completed.add(id);
                    await commitRecord(id, record, itemDiagnostics);
                    surfaceDiagnostics(id, title, itemDiagnostics);
                    onLog(`[PDF] ${title} 导出成功 (${artifact.fileName})`, 'info');
                }
            } catch (e: any) {
                if (isAbortError(e) || this.aborted || signal?.aborted) break;
                failItem(id, title, e?.message || String(e), itemDiagnostics);
            }
            report(i + 1, title);
        }

        wasAborted = this.aborted || !!signal?.aborted;

        // ZIP transaction boundary (report §1): finalize + deliver FIRST,
        // commit final success records ONLY after the user actually receives
        // the ZIP. A generateBlob/download failure must never leave staged
        // items marked successful — they are reported as failed (retryable).
        // Never package or download after a cancel (user intent); staged
        // items on abort are reported as failed/retryable below, never
        // counted as succeeded.
        if (!wasAborted && useZip && staged.length > 0) {
            const zipFileName = `gemini_export_pdf_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
            try {
                if (typeof activeWriter.generateBlob !== 'function') {
                    throw new Error('writer.generateBlob is not available; cannot finalize ZIP');
                }
                const blob = await activeWriter.generateBlob((pct: number) =>
                    onProgress({ current: total, total, pct: Math.floor(pct), title: '打包 ZIP' })
                );
                // downloadHandler was validated up front in ZIP mode; the
                // guard below is unreachable defense-in-depth that stays loud.
                const deliver = options.downloadHandler;
                if (typeof deliver !== 'function') {
                    throw new Error('internal invariant: downloadHandler is required for ZIP delivery');
                }
                await deliver(blob, zipFileName);
                // Delivered. Now — and only now — commit final success.
                for (const s of staged) {
                    succeeded++;
                    completed.add(s.id);
                    await commitRecord(s.id, s.record, s.diagnostics);
                    surfaceDiagnostics(s.id, s.title, s.diagnostics);
                }
                onLog(`[PDF] ZIP 打包交付成功 (${zipFileName})，${staged.length} 个文件确认成功`, 'info');
            } catch (e: any) {
                const msg = e?.message || String(e);
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
