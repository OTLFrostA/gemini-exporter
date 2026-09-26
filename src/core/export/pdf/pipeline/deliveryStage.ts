/**
 * src/core/export/pdf/pipeline/deliveryStage.ts
 *
 * D7 M5: S5 delivery stage — the writer/delivery transaction (corrected).
 *
 * Batch-ZIP semantics (per D7 coordinator correction, #577):
 * - folder writer (useZip === false): writeFile() resolving IS delivery —
 *   the file is on disk the moment it resolves; per-item output
 *   { ..., finalized: true };
 * - ZIP writer: the batch shares ONE writer. deliverStage per item only
 *   STAGES the PDF into the in-memory ZIP area — it NEVER calls
 *   generateBlob() or downloadHandler() (N conversations must not trigger
 *   N downloads). Per-item output is { ..., finalized: false }; the
 *   orchestrator maps it to item status 'staged' (never delivered).
 * - the batch driver calls finalizeZipDelivery() ONCE at the end of the
 *   batch: the single generateBlob() + downloadHandler() that delivers the
 *   ZIP to the user, then flips staged items to delivered.
 *
 * Transaction guarantees (from #556/#567/#571):
 * - a missing downloadHandler is a configuration error and fails the item
 *   fast (never silently counted as delivered, per #567);
 * - any write/finalize/download failure throws StageError (retryable);
 *   the error carries diagnostics describing the partial state so nothing
 *   is lost quietly (per #571), and the failure is logged loudly.
 *
 * This stage never swallows content loss: every failure path throws with
 * diagnostics; success returns an ArtifactWriteReport describing exactly
 * what was delivered (or staged).
 */

import { buildExportFileName } from '../../../utils/pathUtils.js';
import type {
    ArtifactWriteReport,
    RenderDiagnostic,
} from '../../canonical/rendering.js';
import type { IExportWriter } from '../../../engine/writers/writerInterface.js';
import {
    StageError,
    type DeliveryStageInput,
    type DeliveryStageOutput,
    type StageContext,
    type StageFn,
} from './types.js';

function abortIfCancelled(ctx: StageContext, where = "stage 'deliver'"): void {
    if (ctx.signal.aborted) {
        throw new DOMException(`Pipeline aborted during ${where}`, 'AbortError');
    }
}

function errorDiag(code: string, message: string, path?: string): RenderDiagnostic {
    return { severity: 'error', code, message, path };
}

function fail(
    ctx: StageContext,
    label: string,
    code: string,
    message: string,
    options: { retryable: boolean; cause?: unknown; diagnostics?: RenderDiagnostic[] },
): never {
    ctx.log(`[PDF] ${label} deliver failed: ${message}`, 'error');
    throw new StageError('deliver', code, message, options);
}

/**
 * Per-item delivery stage.
 *
 * Folder mode: writeFile() resolving IS delivery (finalized: true).
 * ZIP mode: only STAGES the PDF into the batch writer (finalized: false).
 * The batch driver MUST run finalizeZipDelivery() once at the end of the
 * batch before staged items count as delivered.
 */
export const deliverStage: StageFn<DeliveryStageInput, DeliveryStageOutput> = async (
    input: DeliveryStageInput,
    ctx: StageContext,
): Promise<{ output: DeliveryStageOutput; diagnostics: RenderDiagnostic[] }> => {
    const { conversationId, title, pdfBytes, useZip, writer } = input;
    const label = title || conversationId;
    const fileName = buildExportFileName(title, conversationId, 'pdf');

    // #567: fail fast on configuration error BEFORE any write work. Without
    // a handler the batch ZIP can never reach the user, so the item must
    // fail loudly here — it is never silently counted as delivered. This is
    // defense in depth: the batch driver also checks up front.
    if (useZip && typeof input.downloadHandler !== 'function') {
        const message =
            'zip export requires downloadHandler: without it the batch ZIP can never be delivered to the user';
        fail(ctx, label, 'MISSING_DOWNLOAD_HANDLER', message, {
            retryable: false,
            diagnostics: [errorDiag('MISSING_DOWNLOAD_HANDLER', message, conversationId)],
        });
    }

    abortIfCancelled(ctx);

    // Land the bytes through the writer. Folder mode: this IS delivery.
    // ZIP mode: this only STAGES into the shared in-memory ZIP area — the
    // per-item stage must NEVER package or download here.
    try {
        await writer.writeFile(fileName, pdfBytes);
    } catch (e: unknown) {
        const message = `writeFile failed for ${fileName}: ${(e as Error)?.message ?? String(e)}`;
        fail(ctx, label, 'WRITE_FAILED', message, {
            retryable: true,
            cause: e,
            diagnostics: [errorDiag('WRITE_FAILED', message, conversationId)],
        });
    }

    const writeReport: ArtifactWriteReport = {
        fileName,
        target: useZip ? 'zip' : 'folder',
        bytesWritten: pdfBytes.byteLength,
        writtenAt: new Date().toISOString(),
    };

    if (!useZip) {
        ctx.log(`[PDF] ${label} 导出成功 (${fileName})`, 'info');
        return { output: { writeReport, finalized: true }, diagnostics: [] };
    }

    ctx.log(`[PDF] ${label} 已暂存到 ZIP (${fileName})`, 'info');
    return { output: { writeReport, finalized: false }, diagnostics: [] };
};

/**
 * Batch-level ZIP finalize (M5, corrected per D7 coordinator).
 *
 * Runs the SINGLE generateBlob() + downloadHandler() for the whole batch.
 * The batch driver calls this once after all items are staged, then flips
 * 'staged' items to 'delivered'. Never package or download after a cancel
 * (user intent); a finalize failure leaves items staged — never counted as
 * delivered — and throws StageError with diagnostics spelling that out.
 *
 * @returns bytesWritten — the byte size of the delivered ZIP blob.
 */
export async function finalizeZipDelivery(
    writer: IExportWriter,
    downloadHandler: (blob: Blob, filename: string) => void | Promise<void>,
    zipFileName: string,
    ctx: StageContext,
): Promise<{ bytesWritten: number }> {
    // Never package or download after a cancel.
    abortIfCancelled(ctx, 'ZIP finalize');

    // Defense in depth: the batch driver checks up front too, but a missing
    // handler here would throw a confusing TypeError deep in the download.
    if (typeof downloadHandler !== 'function') {
        const message =
            'zip finalize requires downloadHandler: without it the batch ZIP can never be delivered to the user';
        fail(ctx, zipFileName, 'MISSING_DOWNLOAD_HANDLER', message, {
            retryable: false,
            diagnostics: [errorDiag('MISSING_DOWNLOAD_HANDLER', message, zipFileName)],
        });
    }

    if (typeof writer.generateBlob !== 'function') {
        const message =
            'writer.generateBlob is not available; cannot finalize batch ZIP; staged items are NOT delivered';
        fail(ctx, zipFileName, 'ZIP_FINALIZE_UNAVAILABLE', message, {
            retryable: false,
            diagnostics: [errorDiag('ZIP_FINALIZE_UNAVAILABLE', message, zipFileName)],
        });
    }

    let blob: Blob;
    try {
        blob = await writer.generateBlob();
    } catch (e: unknown) {
        const message = `batch ZIP finalize failed: ${(e as Error)?.message ?? String(e)}; staged items are NOT delivered`;
        fail(ctx, zipFileName, 'ZIP_FINALIZE_FAILED', message, {
            retryable: true,
            cause: e,
            diagnostics: [errorDiag('ZIP_FINALIZE_FAILED', message, zipFileName)],
        });
    }

    try {
        await downloadHandler(blob, zipFileName);
    } catch (e: unknown) {
        const message = `batch ZIP download failed for ${zipFileName}: ${(e as Error)?.message ?? String(e)}; the ZIP was generated but NOT delivered to the user`;
        fail(ctx, zipFileName, 'DOWNLOAD_FAILED', message, {
            retryable: true,
            cause: e,
            diagnostics: [errorDiag('DOWNLOAD_FAILED', message, zipFileName)],
        });
    }

    ctx.log(`[PDF] ZIP 批量交付成功 (${zipFileName})`, 'info');
    return { bytesWritten: blob.size };
}
