/**
 * src/core/export/pdf/pipeline/types.ts
 *
 * D7: frozen inter-stage contracts for the end-to-end PDF pipeline.
 *
 * These interfaces are FROZEN as of the M1 PR. M2-M5 implement the stages;
 * they must implement these signatures, not change them. If a stage finds
 * its contract truly insufficient, it must report back to the D7
 * coordinator instead of silently widening it.
 *
 * Pipeline order (per conversation):
 *   S1 project   (M2): projectConversation -> ProjectedView
 *   S2 resources (M3): shared asset collection -> resolveAssets -> pathMap + mounts
 *   S3 payload   (M2): toTypstPayload(bundle, { assetPath, convertMath, projectedMessages })
 *   S4 compile   (M4): resolveLocalFonts -> IPdfCompiler.compile -> verified PDF bytes
 *   S5 deliver   (M5): writer/delivery transaction (#556/#567/#571 semantics) -> write report
 */

import type { CanonicalConversationBundle } from '../../canonical/conversation.js';
import type { ProjectedView } from '../../canonical/projection.js';
import type {
    ArtifactWriteReport,
    RenderDiagnostic,
} from '../../canonical/rendering.js';
import type { InlineByteStore } from '../../assets/byteStore.js';
import type { TypstConversationRenderPayload } from '../../typst/payload.js';
import type { LocalFontResolution } from '../../typst/fonts/localFontProvider.js';
import type { IPdfCompiler } from '../pdfCompiler.js';
import type { IExportWriter } from '../../../engine/writers/writerInterface.js';

/** Re-exported so stage implementers have a single import site. */
export type { RenderDiagnostic } from '../../canonical/rendering.js';

/** Stage names in pipeline order. */
export type PipelineStageName = 'project' | 'resources' | 'payload' | 'compile' | 'deliver';

export const PIPELINE_STAGE_ORDER: readonly PipelineStageName[] = [
    'project',
    'resources',
    'payload',
    'compile',
    'deliver',
];

/**
 * Cross-cutting context every stage receives. Cancellation must propagate:
 * stages MUST stop promptly when ctx.signal aborts and throw a DOMException
 * named 'AbortError' (never convert an abort into a quiet failure).
 */
export interface StageContext {
    signal: AbortSignal;
    reportProgress(stage: string, current: number, total: number): void;
    log(message: string, level?: 'info' | 'warn' | 'error'): void;
}

/**
 * Uniform stage signature: typed input, typed output, diagnostics travel
 * alongside. A stage never swallows content loss: anything dropped or
 * degraded must appear in diagnostics (severity warning or error).
 */
export type StageFn<I, O> = (
    input: I,
    ctx: StageContext,
) => Promise<{ output: O; diagnostics: RenderDiagnostic[] }>;

/** Typed error thrown (or wrapped) when a stage fails. Never silent. */
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

// ---------------------------------------------------------------------------
// S1: projection (M2)
// ---------------------------------------------------------------------------

export interface ProjectStageInput {
    bundle: CanonicalConversationBundle;
    /** Explicit leaf override; defaults to bundle.conversation.selectedLeafMessageId. */
    leafMessageId?: string;
}

export interface ProjectStageOutput {
    bundle: CanonicalConversationBundle;
    view: ProjectedView;
}

// ---------------------------------------------------------------------------
// S2: resources (M3)
// ---------------------------------------------------------------------------

/** One sandbox-mountable image: virtual path -> bytes. */
export interface ImageMount {
    virtualPath: string;
    bytes: Uint8Array;
    mimeType: string;
}

export interface ResourceStageInput {
    bundle: CanonicalConversationBundle;
    view: ProjectedView;
    /** Per-run byte store, created alongside normalize and threaded through. */
    byteStore: InlineByteStore;
}

export interface ResourceStageOutput {
    /** assetId -> virtual path, only for assets that resolved cleanly. */
    pathMap: Map<string, string>;
    /** virtual path -> bytes, mounted into the sandbox before compile. */
    mounts: ImageMount[];
    /**
     * Assets referenced by the projected view but not resolved. Every entry
     * is diagnosed (never silent); the payload stage renders them as visible
     * unknown nodes + diagnostics.
     */
    unresolved: Array<{ assetId: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// S3: Typst payload (M2)
// ---------------------------------------------------------------------------

export interface PayloadStageInput {
    bundle: CanonicalConversationBundle;
    view: ProjectedView;
    /** From S2. The payload stage must NOT re-resolve assets. */
    pathMap: Map<string, string>;
}

export interface PayloadStageOutput {
    payload: TypstConversationRenderPayload;
}

// ---------------------------------------------------------------------------
// S4: compile + verify (M4)
// ---------------------------------------------------------------------------

export interface CompileStageInput {
    payload: TypstConversationRenderPayload;
    /** For building the RenderContext the compiler expects. */
    bundle: CanonicalConversationBundle;
    /** From S2. */
    mounts: ImageMount[];
    /**
     * From S2 (assetId -> virtualPath). S4 builds the mount-backed
     * AssetResolver as resolve(assetId) = mounts[pathMap[assetId]].bytes;
     * without it the stage would have to guess the mapping from virtual
     * paths, which is unsound for content-hash-shaped paths.
     */
    pathMap: ReadonlyMap<string, string>;
    /**
     * Resolved inside S4 via resolveLocalFonts(); carried here so tests can
     * inject a canned resolution without touching the font provider.
     */
    fonts: LocalFontResolution;
    /** Injected: stub in tests, TypstSandboxCompiler in production (M6). */
    compiler: IPdfCompiler;
    locale: 'zh' | 'en';
}

export interface CompileStageOutput {
    /**
     * Verified PDF bytes: non-empty, starts with %PDF, parseable.
     * A failed verification is a stage failure, never a blank PDF marked ok.
     */
    pdfBytes: Uint8Array;
}

// ---------------------------------------------------------------------------
// S5: delivery (M5)
// ---------------------------------------------------------------------------

export interface DeliveryStageInput {
    conversationId: string;
    title: string;
    pdfBytes: Uint8Array;
    useZip: boolean;
    writer: IExportWriter;
    /**
     * REQUIRED when useZip is true. Delivery is complete only after this
     * handler resolves; a missing handler is a configuration error and
     * fails the item (never silently counted as delivered).
     */
    downloadHandler?: (blob: Blob, filename: string) => void | Promise<void>;
    folderName: string;
}

export interface DeliveryStageOutput {
    writeReport: ArtifactWriteReport;
    /**
     * True when the artifact bytes are durably delivered (folder writeFile
     * resolved). False when the artifact is only STAGED into a batch writer
     * (batch ZIP mode): the batch driver must still run the single
     * generateBlob() + downloadHandler() finalize before staged items count
     * as delivered. A 'staged' item is never reported as success.
     */
    finalized: boolean;
}

// ---------------------------------------------------------------------------
// Orchestrator I/O
// ---------------------------------------------------------------------------

/** All five stage implementations, injected into the orchestrator. */
export interface PipelineStages {
    project: StageFn<ProjectStageInput, ProjectStageOutput>;
    resources: StageFn<ResourceStageInput, ResourceStageOutput>;
    payload: StageFn<PayloadStageInput, PayloadStageOutput>;
    compile: StageFn<CompileStageInput, CompileStageOutput>;
    deliver: StageFn<DeliveryStageInput, DeliveryStageOutput>;
}

/** One conversation entering the pipeline (post-normalize). */
export interface PipelineItemInput {
    conversationId: string;
    title: string;
    bundle: CanonicalConversationBundle;
    /** Per-run store created alongside normalize; S2 consumes it. */
    byteStore: InlineByteStore;
    locale: 'zh' | 'en';
    compiler: IPdfCompiler;
    fonts: LocalFontResolution;
    useZip: boolean;
    writer: IExportWriter;
    downloadHandler?: (blob: Blob, filename: string) => void | Promise<void>;
    folderName: string;
    /** Explicit branch leaf override for S1; defaults to the bundle's selection. */
    leafMessageId?: string;
}

export interface PipelineContext {
    signal: AbortSignal;
    reportProgress(stage: string, current: number, total: number): void;
    log(message: string, level?: 'info' | 'warn' | 'error'): void;
}

export type PipelineItemStatus = 'delivered' | 'staged' | 'failed' | 'aborted';

export interface PipelineItemResult {
    conversationId: string;
    title: string;
    status: PipelineItemStatus;
    /** Present only when status === 'delivered'. */
    writeReport?: ArtifactWriteReport;
    /** Present only when status === 'failed'. */
    error?: { stage: PipelineStageName | 'pipeline'; code: string; message: string; retryable: boolean };
    /** Every diagnostic from every stage, in stage order. Never dropped. */
    diagnostics: RenderDiagnostic[];
}
