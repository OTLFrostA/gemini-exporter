/**
 * src/core/export/pdf/pipeline/orchestrator.ts
 *
 * D7 M1: per-conversation pipeline orchestrator skeleton.
 *
 * Wires S1->S5 in the frozen order. Stage implementations are injected, so
 * M2-M5 can be built and tested independently against the frozen contracts.
 * This skeleton owns only the wiring and the failure mapping:
 *
 * - diagnostics from every stage accumulate in stage order and are never dropped;
 * - a stage failure marks the item failed (retryable per StageError.retryable);
 * - an abort marks the item aborted, never failed;
 * - 'delivered' is returned ONLY after the deliver stage completes.
 */

import { runStage } from './runner.js';
import {
    PIPELINE_STAGE_ORDER,
    StageError,
    type PipelineContext,
    type PipelineItemInput,
    type PipelineItemResult,
    type PipelineStageName,
    type PipelineStages,
    type RenderDiagnostic,
    type StageContext,
} from './types.js';

function isAbortError(e: unknown): boolean {
    return (
        (e instanceof DOMException && e.name === 'AbortError') ||
        (typeof e === 'object' && e !== null && (e as any).name === 'AbortError')
    );
}

export class PdfPipeline {
    constructor(private readonly stages: PipelineStages) {}

    /**
     * Run the full S1->S5 pipeline for one conversation.
     * Never throws for item-level failures: they are returned as
     * { status: 'failed' }. AbortError from the signal propagates to the
     * caller (batch-level abort handling lives in the caller, per #571).
     */
    async runOne(input: PipelineItemInput, pctx: PipelineContext): Promise<PipelineItemResult> {
        const diagnostics: RenderDiagnostic[] = [];
        const ctx: StageContext = {
            signal: pctx.signal,
            reportProgress: pctx.reportProgress,
            log: pctx.log,
        };
        const { conversationId, title } = input;

        const fail = (
            stage: PipelineStageName | 'pipeline',
            code: string,
            message: string,
            retryable: boolean,
        ): PipelineItemResult => ({
            conversationId,
            title,
            status: 'failed',
            error: { stage, code, message, retryable },
            diagnostics,
        });

        try {
            // S1: projection (shared; PDF never linearizes on its own).
            ctx.reportProgress('project', 0, PIPELINE_STAGE_ORDER.length);
            const projected = await runStage('project', this.stages.project, {
                bundle: input.bundle,
                leafMessageId: input.leafMessageId,
            }, ctx);
            diagnostics.push(...projected.diagnostics);

            // S2: resources (must precede S3: payload.assetPath reads pathMap).
            ctx.reportProgress('resources', 1, PIPELINE_STAGE_ORDER.length);
            const resources = await runStage('resources', this.stages.resources, {
                bundle: input.bundle,
                view: projected.output.view,
                byteStore: input.byteStore,
            }, ctx);
            diagnostics.push(...resources.diagnostics);

            // S3: Typst payload (consumes the S1 view; no private linearize).
            ctx.reportProgress('payload', 2, PIPELINE_STAGE_ORDER.length);
            const payload = await runStage('payload', this.stages.payload, {
                bundle: input.bundle,
                view: projected.output.view,
                pathMap: resources.output.pathMap,
            }, ctx);
            diagnostics.push(...payload.diagnostics);

            // S4: compile + verify.
            ctx.reportProgress('compile', 3, PIPELINE_STAGE_ORDER.length);
            const compiled = await runStage('compile', this.stages.compile, {
                payload: payload.output.payload,
                bundle: input.bundle,
                mounts: resources.output.mounts,
                pathMap: resources.output.pathMap,
                fonts: input.fonts,
                compiler: input.compiler,
                locale: input.locale,
            }, ctx);
            diagnostics.push(...compiled.diagnostics);

            // S5: delivery. Only a completed delivery marks the item delivered.
            ctx.reportProgress('deliver', 4, PIPELINE_STAGE_ORDER.length);
            const delivered = await runStage('deliver', this.stages.deliver, {
                conversationId: input.conversationId,
                title: input.title,
                pdfBytes: compiled.output.pdfBytes,
                useZip: input.useZip,
                writer: input.writer,
                downloadHandler: input.downloadHandler,
                folderName: input.folderName,
            }, ctx);
            diagnostics.push(...delivered.diagnostics);

            ctx.reportProgress('done', PIPELINE_STAGE_ORDER.length, PIPELINE_STAGE_ORDER.length);
            return {
                conversationId,
                title,
                status: 'delivered',
                writeReport: delivered.output.writeReport,
                diagnostics,
            };
        } catch (e) {
            if (isAbortError(e)) {
                // Abort is terminal for this item but NOT a failure: the item
                // stays retryable and must not be recorded as failed (#571).
                return { conversationId, title, status: 'aborted', diagnostics };
            }
            if (e instanceof StageError) {
                ctx.log(
                    `[PDF] ${title || conversationId} pipeline failed at stage '${e.stage}': ${e.message}`,
                    'error',
                );
                return fail(e.stage, e.code, e.message, e.retryable);
            }
            const message = (e as Error)?.message ?? String(e);
            ctx.log(`[PDF] ${title || conversationId} pipeline failed: ${message}`, 'error');
            return fail('pipeline', 'PIPELINE_THREW', message, true);
        }
    }
}
