import type { ExportArtifact } from '../artifacts.js';
import type { Asset } from './assets.js';
import type { CanonicalConversationBundle } from './conversation.js';
export type { TypstRenderPayload } from '../pdf/pdfCompiler.js';

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
    renderUrl?: string;
}

export interface AssetResolver {
    resolve(assetId: string): Promise<ResolvedAsset | null>;
}

export interface RenderContext {
    bundle: CanonicalConversationBundle;
    assets: AssetResolver;
    locale: 'zh' | 'en';
    signal: AbortSignal;
    reportProgress(stage: string, current: number, total: number): void;
}

export interface ThoughtRenderOptions {
    initiallyCollapsed?: boolean;
}

export interface ConversationRenderer {
    readonly format: 'html' | 'markdown' | 'pdf' | string;
    render(context: RenderContext): Promise<ExportArtifact>;
}
