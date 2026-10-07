import type { ConversationRecordInput } from './record/conversationRecord.js';
import { parseConversation } from './parseConversation.js';
import type { ConversationRecordParseResult } from './record/parseConversationRecord.js';

/** Historical application boundary. Identity inference stays here until raw producers migrate. */
export interface LegacyDomainConstructionOptions {
    providerId?: string;
    generatedMedia?: readonly unknown[];
}

/** @deprecated New Domain callers use parseConversation with explicit format and providerId. */
export function parseProviderConversation(conversation: ConversationRecordInput, options: LegacyDomainConstructionOptions = {}): ConversationRecordParseResult {
    return parseConversation({
        format: 'conversation-record',
        providerId: options.providerId ?? inferLegacyProviderId(conversation),
        data: conversation,
        generatedMedia: options.generatedMedia,
    });
}

/** Isolated compatibility heuristic; raw parsers always supply their producer explicitly. */
export function inferLegacyProviderId(conversation: ConversationRecordInput): string {
    return conversation.source?.startsWith('openai') ? 'openai' : 'gemini';
}
