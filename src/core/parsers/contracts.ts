import type { TrustedDomain } from '../domain/runtimeValidation.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';

/** Every raw parser knows its producer. No filename/source-string heuristics at this boundary. */
export interface ConversationParseContext {
    providerId: string;
}

/** Parsers establish semantic quality in Domain; diagnostics report observations only. */
export interface ConversationParseResult {
    conversation: TrustedDomain;
    /** Source activity version captured with this body (epoch ms). Persist as savedAt.
     * The canonical Index may advance independently; never store capture metadata in Detail. */
    sourceVersion?: number;
    diagnostics: Diagnostic[];
}

/** Raw decoders construct a closed Domain graph before returning, including after async acquisition. */
export type ConversationParser<Raw, Result extends ConversationParseResult = ConversationParseResult> =
    (raw: Raw, context: ConversationParseContext) => Result | Promise<Result>;
