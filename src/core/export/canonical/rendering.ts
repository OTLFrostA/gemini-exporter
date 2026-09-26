/**
 * src/core/export/canonical/rendering.ts
 * Renderer contract shared by the HTML and PDF routes.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/rendering.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 *
 * Adaptation notes (integration doc section 3):
 * - Item 5 (render interface): RenderContext now carries AbortSignal and a
 *   stage progress reporter; ExportArtifact now carries the companion
 *   resource plan and the write report, so artifact generation, actual file
 *   writing and export-record update stay three separate stages.
 * - Item 6 (representation independence): thought folding defaults are
 *   renderer configuration (ThoughtRenderOptions), not canonical content.
 */

import type { Asset } from './assets.js';
import type { CanonicalConversationBundle } from './conversation.js';

export interface RenderDiagnostic {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
    path?: string;
}

export interface ResolvedAsset {
    asset: Asset;
    blob?: Blob;
    bytes?: Uint8Array;
    /** Object/data/internal URL valid for this render invocation only. */
    renderUrl?: string;
}

export interface AssetResolver {
    resolve(assetId: string): Promise<ResolvedAsset | null>;
}

export interface RenderContext {
    bundle: CanonicalConversationBundle;
    assets: AssetResolver;
    locale: 'zh' | 'en';
    /** Cancellation signal; renderers must stop promptly when aborted. */
    signal: AbortSignal;
    reportProgress(stage: string, current: number, total: number): void;
}

export interface CompanionResourcePlan {
    /** Asset ids whose originals must be written alongside the artifact. */
    resourceIds: string[];
    /** Assets deliberately not shipped, with the reason (diagnosed). */
    omitted: Array<{ resourceId: string; reason: string }>;
}

/**
 * Proof of the actual write. Generation, writing and record update are three
 * independent stages; only a completed write report may mark an export done.
 * Written by the Writer layer (IExportWriter), not by the renderer.
 */
export interface ArtifactWriteReport {
    fileName: string;
    target: 'zip' | 'folder' | string;
    bytesWritten: number;
    writtenAt: string;
}

export interface ExportArtifact {
    fileName: string;
    mimeType: string;
    content: string | Blob | Uint8Array;
    /** Original assets that must be persisted next to this artifact. */
    companionResourceIds: string[];
    companionPlan?: CompanionResourcePlan;
    /** Present only after the Writer actually landed the file. */
    writeReport?: ArtifactWriteReport;
    diagnostics?: RenderDiagnostic[];
}

/**
 * Renderer-owned view configuration for provider-exposed thought content.
 * This is deliberately NOT part of the canonical AST: collapsing is how the
 * renderer presents content, not what the content is.
 */
export interface ThoughtRenderOptions {
    initiallyCollapsed?: boolean;
}

export interface ConversationRenderer {
    readonly format: 'html' | 'markdown' | 'pdf' | string;
    render(context: RenderContext): Promise<ExportArtifact>;
}

/**
 * Example of disposable PDF/Typst-specific data. This is intentionally not
 * part of CanonicalConversationBundle; it exists for one render invocation
 * only and must never be written back to canonical/archive storage.
 */
export interface TypstDerivedMessageHints {
    messageId: string;
    plainText?: string;
}

export interface TypstDerivedMath {
    sourceLatex: string;
    typst?: string;
    conversionError?: string;
}

export interface TypstRenderPayload {
    rendererSchemaVersion: 1;
    sourceSchemaVersion: 1;
    bundle: CanonicalConversationBundle;
    messageHints?: TypstDerivedMessageHints[];
    convertedMath?: Record<string, TypstDerivedMath>;
}
