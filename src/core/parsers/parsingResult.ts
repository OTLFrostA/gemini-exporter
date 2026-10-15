import type { ConversationParseResult } from './contracts.js';
import type { LegacyResourceHints } from './shared/resources/resourceHints.js';
import type { ResourceAcquisitionHints } from '../resources/resourceAcquisition.js';

/** Producer preparation evidence remains beside the common semantic result. */
export interface ResourceConversationParseResult extends ConversationParseResult {
    resourceHints: LegacyResourceHints;
    acquisitionHints: ResourceAcquisitionHints;
}

/** Acquisition failures carry no Domain graph; they remain reportable by native consumers. */
export interface ConversationAcquisitionFailure {
    id?: string | number | null; title?: string | null; url?: string; error: string;
    isDeleted?: boolean; _empty?: boolean; _debug?: unknown; _raw?: unknown;
    retryAfterMs?: number; rawResponse?: unknown;
}
export type NativeConversationInput = ResourceConversationParseResult | ConversationAcquisitionFailure | null | undefined;

/** Narrow already typed internal inputs; never upgrade unknown data into TrustedDomain. */
export function isResourceConversationParseResult(value: NativeConversationInput): value is ResourceConversationParseResult {
    if (!value || typeof value !== 'object' || !('conversation' in value)) return false;
    if (!('diagnostics' in value) || !Array.isArray(value.diagnostics)
        || !('resourceHints' in value) || !value.resourceHints || typeof value.resourceHints !== 'object' || Array.isArray(value.resourceHints)
        || !('acquisitionHints' in value) || !value.acquisitionHints || typeof value.acquisitionHints !== 'object' || Array.isArray(value.acquisitionHints)) {
        throw new TypeError('Malformed native conversation result');
    }
    return true;
}
