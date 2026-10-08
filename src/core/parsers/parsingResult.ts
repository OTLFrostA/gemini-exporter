import { assertDomainClosure } from '../domain/closure.js';
import type { ConversationParseResult } from './contracts.js';
import type { LegacyResourceHints } from './shared/resources/resourceHints.js';
import type { ResourceAcquisitionHints } from './shared/resources/resourceAcquisitionHints.js';

/** Producer preparation evidence remains beside the common semantic result. */
export interface ResourceConversationParseResult extends ConversationParseResult {
    resourceHints: LegacyResourceHints;
    acquisitionHints: ResourceAcquisitionHints;
}

/** Validate a native runtime value without interpreting legacy records or source syntax. */
export function isResourceConversationParseResult(value: unknown): value is ResourceConversationParseResult {
    if (!value || typeof value !== 'object' || !('conversation' in value)) return false;
    if (!('diagnostics' in value) || !Array.isArray(value.diagnostics)
        || !('resourceHints' in value) || !value.resourceHints || typeof value.resourceHints !== 'object' || Array.isArray(value.resourceHints)
        || !('acquisitionHints' in value) || !value.acquisitionHints || typeof value.acquisitionHints !== 'object' || Array.isArray(value.acquisitionHints)) {
        throw new TypeError('Malformed native conversation result');
    }
    assertDomainClosure((value as ResourceConversationParseResult).conversation);
    return true;
}
