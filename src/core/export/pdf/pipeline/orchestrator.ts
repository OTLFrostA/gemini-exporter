import type { ResourceResult, ResourceDelivery } from '../../../resources/resourceResult.js';
import { isAbortError, PdfResourceError } from '../errors.js';
import { resourceDiagnostics } from '../../../resources/resourceResult.js';
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

export class PdfPipeline {
    constructor(private readonly stages: PipelineStages) {}

    async runOne(input: PipelineItemInput, pctx: PipelineContext): Promise<PipelineItemResult> {
        const diagnostics: RenderDiagnostic[] = [];
        const resourceResults: ResourceResult<ResourceDelivery>[] = [];
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
            diagnostics, resourceResults,
        });

        try {
            ctx.reportProgress('resources', 0, PIPELINE_STAGE_ORDER.length);
            const resources = await runStage('resources', this.stages.resources, {
                document: input.document,
                resources: input.resources,
            }, ctx);
            diagnostics.push(...resources.diagnostics);
            resourceResults.push(...resources.output.resourceResults);

            ctx.reportProgress('payload', 1, PIPELINE_STAGE_ORDER.length);
            let payload = await runStage('payload', this.stages.payload, {
                document: input.document,
                pathMap: resources.output.pathMap,
                locale: input.locale,
            }, ctx);
            diagnostics.push(...payload.diagnostics);

            ctx.reportProgress('compile', 2, PIPELINE_STAGE_ORDER.length);
            const compile = () => runStage('compile', this.stages.compile, {
                payload: payload.output.payload,
                resourceIds: new Set(input.resources.keys()),
                mounts: resources.output.mounts,
                pathMap: resources.output.pathMap,
                fonts: input.fonts,
                compiler: input.compiler,
            }, ctx);
            let compiled;
            try { compiled = await compile(); }
            catch (error) {
                const failure = error instanceof StageError ? error.cause : error;
                if (!(failure instanceof PdfResourceError) || !failure.failures.length
                    || failure.failures.some(result => !resources.output.pathMap.has(result.resourceId))) throw error;
                for (const result of failure.failures) {
                    resources.output.pathMap.delete(result.resourceId);
                    const index = resourceResults.findIndex(existing => existing.resourceId === result.resourceId);
                    if (index >= 0) resourceResults[index] = result;
                }
                diagnostics.push(...resourceDiagnostics(failure.failures));
                payload = await runStage('payload', this.stages.payload, {
                    document: input.document, pathMap: resources.output.pathMap, locale: input.locale,
                }, ctx);
                diagnostics.push(...payload.diagnostics);
                // One recovery pass; persistent or unrelated compile failures remain fatal.
                compiled = await compile();
            }
            diagnostics.push(...compiled.diagnostics);

            ctx.reportProgress('deliver', 3, PIPELINE_STAGE_ORDER.length);
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
            if (delivered.output.finalized) {
                return {
                    conversationId,
                    title,
                    status: 'delivered',
                    writeReport: delivered.output.writeReport,
                    diagnostics, resourceResults,
                };
            }
            return {
                conversationId,
                title,
                status: 'staged',
                stagedArtifact: {
                    fileName: delivered.output.writeReport.fileName,
                    bytesWritten: delivered.output.writeReport.bytesWritten,
                },
                diagnostics, resourceResults,
            };
        } catch (e) {
            if (isAbortError(e)) {
                return { conversationId, title, status: 'aborted', diagnostics, resourceResults };
            }
            if (e instanceof StageError) {
                ctx.log(
                    `[PDF] ${title || conversationId} pipeline failed at stage '${e.stage}': ${e.message}`,
                    'error',
                );
                diagnostics.push(...e.diagnostics);
                return fail(e.stage, e.code, e.message, e.retryable);
            }
            const message = (e as Error)?.message ?? String(e);
            ctx.log(`[PDF] ${title || conversationId} pipeline failed: ${message}`, 'error');
            return fail('pipeline', 'PIPELINE_THREW', message, true);
        }
    }
}
