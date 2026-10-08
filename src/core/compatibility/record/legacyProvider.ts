import type { ConversationRecordInput } from './conversationRecord.js';

/** Historical application boundary. Identity inference stays here until raw producers migrate. */
export interface LegacyDomainConstructionOptions {
    providerId?: string;
    generatedMedia?: readonly unknown[];
}

/** Isolated compatibility heuristic; raw parsers always supply their producer explicitly. */
export function inferLegacyProviderId(conversation: ConversationRecordInput): string {
    return conversation.source?.startsWith('openai') ? 'openai' : 'gemini';
}
