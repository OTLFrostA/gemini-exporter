import type { Account } from '../domain/accountRegistry.js';
import type { TrustedDomain } from '../domain/runtimeValidation.js';
import type { QualityEvidence } from '../domain/quality.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';

/** Every raw parser knows its producer. No filename/source-string heuristics at this boundary. */
export interface ConversationParseContext {
    providerId: string;
    account: Account;
}

/** Parsers establish semantic quality in Domain; diagnostics report observations only. */
export interface ConversationParseResult {
    account: Account;
    conversation: TrustedDomain;
    /** Source activity version captured with this body (epoch ms). Persist as savedAt.
     * The canonical Index may advance independently; this remains a source fact, not a local write clock. */
    sourceVersion?: number;
    evidence?: QualityEvidence;
    diagnostics: Diagnostic[];
}

/** Raw decoders construct a closed Domain graph before returning, including after async acquisition. */
export type ConversationParser<Raw, Result extends ConversationParseResult = ConversationParseResult> =
    (raw: Raw, context: ConversationParseContext) => Result | Promise<Result>;

/** Transient list source facts; L1 binds these to a Registry UUID before L2 admission. */
export interface ProviderConversationItem { id: string; title?: string; titleSource?: string; createdAt?: number; updatedAt?: number }
