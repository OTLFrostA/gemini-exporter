import type { DomainConversationDetail } from '../domain/conversationDetail.js';
import type { DocumentDiagnostic } from '../diagnostics/documentDiagnostic.js';

/** Every raw parser knows its producer. No filename/source-string heuristics at this boundary. */
export interface ConversationParseContext {
    providerId: string;
}

/** Shared parser output. Problems are side-channel records, never conversation fields. */
export interface ConversationParseResult {
    conversation: DomainConversationDetail;
    diagnostics: DocumentDiagnostic[];
}

/** Raw decoders construct a closed Domain graph before returning, including after async acquisition. */
export type ConversationParser<Raw, Result extends ConversationParseResult = ConversationParseResult> =
    (raw: Raw, context: ConversationParseContext) => Result | Promise<Result>;
