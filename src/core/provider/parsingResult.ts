import type { ConversationParseResult } from '../domain/parsing.js';
import type { LegacyResourceHints } from '../export/assets/resourceHints.js';
import type { ResourceAcquisitionHints } from '../export/assets/resourceAcquisitionHints.js';

/** Producer preparation evidence remains beside the common semantic result. */
export interface ResourceConversationParseResult extends ConversationParseResult {
    resourceHints: LegacyResourceHints;
    acquisitionHints: ResourceAcquisitionHints;
}
