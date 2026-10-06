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
    images?: AssetNormalizationInput[];
    documents?: AssetNormalizationInput[];
    groundingCitationMarkers?: unknown[];
}

export interface CanonicalMessageInput {
    message: CanonicalSemanticMessage;
    locator: string;
    /** Preserve original positional message identity when a legacy entry is rejected. */
    sourceIndex?: number;
    /** Reasoning remains a separate legacy string in Domain; its export presentation is prepared separately. */
    reasoningBlocks?: BlockNode[];
    citationInput: { list: RawCitation[]; skipped: number };
    diagnostics?: Diagnostic[];
    unknownFields?: string[];
}
