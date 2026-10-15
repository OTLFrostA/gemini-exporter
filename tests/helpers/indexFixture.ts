import { restoreConversationIndex } from '../../src/core/domain/conversationIndex.js';
import { parseLegacyConversationIndex } from '../../src/core/parsers/legacyStorage/parseIndex.js';
import type { DomainConversationIndex } from '../../src/core/domain/conversationIndex.js';

/** Fixtures explicitly adapt historical metadata before exercising canonical consumers. */
export function indexFixture(raw: unknown): DomainConversationIndex {
    try { return restoreConversationIndex(raw); } catch {}
    const index = parseLegacyConversationIndex(raw);
    const fields = raw as Record<string, unknown>;
    // Tests declaring counts here mean observed individual messages, not raw list RPC slots.
    if (typeof fields.messageCount === 'number' && Number.isSafeInteger(fields.messageCount) && fields.messageCount >= 0) index.messageCount = fields.messageCount;
    return index;
}
export function canonicalFixtureStore(store: Record<string, unknown>): Record<string, unknown> {
    for (const [key, value] of Object.entries(store)) {
        if ((key === 'gemini_conversations' || /^gemini_conversations_u\d+$/.test(key)) && Array.isArray(value)) store[key] = value.map(indexFixture);
    }
    return store;
}
