import type { DocumentAst } from '../../document/ast.js';
import type { PreparedResources } from '../../assets/preparedResources.js';
import type {
    ArtifactWriteReport,
} from '../../artifacts.js';
import type { TypstConversationRenderPayload } from '../../typst/transport.js';
import type { LocalFontResolution } from '../../typst/fonts/localFontProvider.js';
import type { IPdfCompiler } from '../pdfCompiler.js';
import type { IExportWriter } from '../../../engine/writers/writerInterface.js';

import type { DocumentDiagnostic as RenderDiagnostic } from '../../document/ast.js';
export type { DocumentDiagnostic as RenderDiagnostic } from '../../document/ast.js';

export type PipelineStageName = 'resources' | 'payload' | 'compile' | 'deliver';

export const PIPELINE_STAGE_ORDER: readonly PipelineStageName[] = [
    'resources',
    'payload',
    'compile',
    'deliver',
];

export interface StageContext {
    signal: AbortSignal;
    reportProgress(stage: string, current: number, total: number): void;
    log(message: string, level?: 'info' | 'warn' | 'error'): void;
}

export type StageFn<I, O> = (
    input: I,
    ctx: StageContext,
) => Promise<{ output: O; diagnostics: RenderDiagnostic[] }>;

export class StageError extends Error {
    readonly stage: PipelineStageName;
    readonly code: string;
    readonly retryable: boolean;
    readonly diagnostics: RenderDiagnostic[];

    constructor(
        stage: PipelineStageName,
        code: string,
        message: string,
        options: { retryable?: boolean; diagnostics?: RenderDiagnostic[]; cause?: unknown } = {},
    ) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = 'StageError';
        this.stage = stage;
        this.code = code;
        this.retryable = options.retryable ?? true;
        this.diagnostics = options.diagnostics ?? [];
    }
}

export interface ImageMount {
    virtualPath: string;
    bytes: Uint8Array;
    mimeType: string;
}

export interface ResourceStageInput {
    document: DocumentAst;
    resources: PreparedResources;
}

export interface ResourceStageOutput {
    /** assetId -> virtual path for resolved binary image assets (metadata-only attachments are excluded). */
    pathMap: Map<string, string>;
    mounts: ImageMount[];
    unresolved: Array<{ assetId: string; reason: string }>;
}

export interface PayloadStageInput {
    document: DocumentAst;
    pathMap: Map<string, string>;
    locale: 'zh' | 'en';
}

export interface PayloadStageOutput {
    payload: TypstConversationRenderPayload;
}

export interface CompileStageInput {
    payload: TypstConversationRenderPayload;
    resourceIds: ReadonlySet<string>;
    mounts: ImageMount[];
    pathMap: ReadonlyMap<string, string>;
    fonts: LocalFontResolution;
    compiler: IPdfCompiler;
}

export interface CompileStageOutput {
    pdfBytes: Uint8Array;
}

export interface DeliveryStageInput {
    conversationId: string;
    title: string;
    pdfBytes: Uint8Array;
    useZip: boolean;
    writer: IExportWriter;
    downloadHandler?: (blob: Blob, filename: string) => void | Promise<void>;
    folderName: string;
}

export interface DeliveryStageOutput {
    writeReport: ArtifactWriteReport;
    /** True when written directly to disk (folder mode); false when staged in memory awaiting batch ZIP finalization. */
    finalized: boolean;
}

export interface PipelineStages {
    resources: StageFn<ResourceStageInput, ResourceStageOutput>;
    payload: StageFn<PayloadStageInput, PayloadStageOutput>;
    compile: StageFn<CompileStageInput, CompileStageOutput>;
    deliver: StageFn<DeliveryStageInput, DeliveryStageOutput>;
}

export interface PipelineItemInput {
    conversationId: string;
    title: string;
    document: DocumentAst;
    resources: PreparedResources;
    locale: 'zh' | 'en';
    compiler: IPdfCompiler;
    fonts: LocalFontResolution;
    useZip: boolean;
    writer: IExportWriter;
    downloadHandler?: (blob: Blob, filename: string) => void | Promise<void>;
    folderName: string;
}

export interface PipelineContext {
    signal: AbortSignal;
    reportProgress(stage: string, current: number, total: number): void;
    log(message: string, level?: 'info' | 'warn' | 'error'): void;
}

export type PipelineItemStatus = 'delivered' | 'staged' | 'failed' | 'aborted';

interface PipelineItemResultBase {
    conversationId: string;
    title: string;
    diagnostics: RenderDiagnostic[];
}

/** Discriminated union ensuring 'staged' ZIP items cannot carry a delivery writeReport before finalization. */
export type PipelineItemResult =
    | (PipelineItemResultBase & {
          status: 'delivered';
          writeReport: ArtifactWriteReport;
      })
    | (PipelineItemResultBase & {
          status: 'staged';
          stagedArtifact: { fileName: string; bytesWritten: number };
      })
    | (PipelineItemResultBase & {
          status: 'failed';
          error: {
              stage: PipelineStageName | 'pipeline';
              code: string;
              message: string;
              retryable: boolean;
          };
      })
    | (PipelineItemResultBase & {
          status: 'aborted';
      });
