import type { ConversationParseResult } from './contracts.js';
import type { LegacyResourceHints } from './shared/resources/resourceHints.js';
import type { ResourceAcquisitionHints } from './shared/resources/resourceAcquisitionHints.js';

/** Producer preparation evidence remains beside the common semantic result. */
export interface ResourceConversationParseResult extends ConversationParseResult {
    resourceHints: LegacyResourceHints;
    acquisitionHints: ResourceAcquisitionHints;
}
