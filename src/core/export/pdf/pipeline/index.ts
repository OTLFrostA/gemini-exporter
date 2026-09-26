/**
 * src/core/export/pdf/pipeline/index.ts
 *
 * D7 end-to-end PDF pipeline: frozen stage contracts (M1) + orchestrator.
 * Stage implementations land in M2-M5; the production compiler swap in M6.
 */

export {
    PIPELINE_STAGE_ORDER,
    StageError,
    type CompileStageInput,
    type CompileStageOutput,
    type DeliveryStageInput,
    type DeliveryStageOutput,
    type ImageMount,
    type PayloadStageInput,
    type PayloadStageOutput,
    type PipelineContext,
    type PipelineItemInput,
    type PipelineItemResult,
    type PipelineItemStatus,
    type PipelineStageName,
    type PipelineStages,
    type ProjectStageInput,
    type ProjectStageOutput,
    type ResourceStageInput,
    type ResourceStageOutput,
    type StageContext,
    type StageFn,
} from './types.js';
export { runStage } from './runner.js';
export { PdfPipeline } from './orchestrator.js';
