import type { TrustedDomain } from '../domain/runtimeValidation.js';
import type { Diagnostic } from '../diagnostics/diagnostic.js';

/** Every raw parser knows its producer. No filename/source-string heuristics at this boundary. */
export interface ConversationParseContext {
    providerId: string;
}

/** Shared parser output. Problems are side-channel records, never conversation fields. */
export interface ConversationParseResult {
    conversation: TrustedDomain;
    /** Captured source activity version (epoch ms). Persist only as savedAt, never in Detail. */
    sourceVersion?: number;
    diagnostics: Diagnostic[];
}

/** Raw decoders construct a closed Domain graph before returning, including after async acquisition. */
export type ConversationParser<Raw, Result extends ConversationParseResult = ConversationParseResult> =
    (raw: Raw, context: ConversationParseContext) => Result | Promise<Result>;
