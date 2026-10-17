import type { DomainConversationIndex } from '../domain/conversationIndex.js';
import type { DomainConversationDetail } from '../domain/conversationDetail.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';
import type { QualityEvidence } from './qualityEvidence.js';
import type { LegacyResourceHints } from './shared/resources/resourceHints.js';
import type { ResourceAcquisitionHints } from '../resources/resourceAcquisition.js';

/** The only L1 Parser output contract. L2 binds keys and validates Domain. */
export interface SourceConversationParseResult {
    conversationId: string;
    conversation: {
        index: Omit<DomainConversationIndex, 'key'>;
        detail: Omit<DomainConversationDetail, 'key'>;
    };
    /** Source activity version captured with this body (epoch ms), never a local write clock. */
    sourceVersion?: number;
    evidence?: QualityEvidence;
    diagnostics: Diagnostic[];
    resourceHints: LegacyResourceHints;
    acquisitionHints: ResourceAcquisitionHints;
}
