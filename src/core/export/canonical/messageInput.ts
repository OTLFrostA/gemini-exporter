import type { BlockNode } from '../../content/blocks.js';
import type { Diagnostic } from './diagnostics.js';
import type { RawCitation } from './gemini/normalizeCitations.js';
import type { AssetNormalizationInput } from './assetInput.js';

/** Semantic body plus existing export metadata; raw provider body formats cannot cross this boundary. */
export interface CanonicalSemanticMessage {
    id?: string;
    role?: string;
    timestamp?: unknown;
    content: BlockNode[];
    attachments?: AssetNormalizationInput[];
    groundingCitationMarkers?: unknown[];
}

export interface CanonicalMessageInput {
    message: CanonicalSemanticMessage;
    locator: string;
    /** Preserve original positional message identity when a legacy entry is rejected. */
    sourceIndex?: number;
    /** Structured reasoning prepared before the semantic input boundary. */
    reasoningBlocks?: BlockNode[];
    /** Closed Domain identities with acquisition URIs, bypassing legacy alias matching. */
    inlineAssetSources?: ReadonlyMap<string, string>;
    citationInput: { list: RawCitation[]; skipped: number };
    diagnostics?: Diagnostic[];
    unknownFields?: string[];
}
