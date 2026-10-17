import { restoreConversationIndex, type DomainConversationIndex } from '../../src/core/domain/conversationIndex.js';
import { parseIndexMetadata } from '../../src/core/parsers/shared/parseIndexMetadata.js';
import { normalizeTimestamp } from '../../src/core/domain/time.js';
import { resolveTitle } from '../../src/core/domain/titleAuthority.js';
import { semanticTitleSource } from '../../src/core/parsers/shared/parseIndexMetadata.js';
import { cleanTitle, isBrandPlaceholderTitle } from '../../src/core/utils/titleUtils.js';
import { fixtureAccount } from './domainFixture.js';
/** Test source facts are explicitly bound before exercising canonical consumers. */
export function indexFixture(value: unknown): DomainConversationIndex {
    if (!value || typeof value !== 'object') throw new TypeError('Invalid fixture');
    const raw = value as Record<string, unknown>;
    if ('key' in raw) return restoreConversationIndex(value);
    const providerId = typeof raw.providerId === 'string' ? raw.providerId : 'gemini';
    const candidates = Object.entries(raw.titles && typeof raw.titles === 'object' ? raw.titles : {}).flatMap(([source, value]) => typeof value === 'string' && !isBrandPlaceholderTitle(value) ? [{ value: cleanTitle(value), source: semanticTitleSource(source) }] : []);
    if (typeof raw.title === 'string' && !isBrandPlaceholderTitle(raw.title)) candidates.unshift({ value: cleanTitle(raw.title), source: semanticTitleSource(typeof raw.titleSource === 'string' ? raw.titleSource : undefined) });
    const title = resolveTitle(candidates);
    return parseIndexMetadata({ account: fixtureAccount(providerId), providerId, id: String(raw.id),
        title: title?.value ?? '', titleSource: title?.source,
        createdAt: normalizeTimestamp(raw.createdAt), updatedAt: normalizeTimestamp(raw.updatedAt ?? raw.timestamp ?? raw.chatTime) });
}
export function canonicalFixtureStore(store: Record<string, unknown>): Record<string, unknown> {
    for (const [key, value] of Object.entries(store)) if (key.startsWith('conversations_') && Array.isArray(value)) store[key] = value.map(row => { const index = indexFixture(row); return { ...index, key: { ...index.key, accountId: key.slice('conversations_'.length) } }; });
    return store;
}
