import { readParsedConversation, createParsedConversationView, type ParsedConversationView } from '../../compatibility/record/projectDomainRecord.js';
import { saveDomainConversation, getStoredDomain, storedParseResult, storageIdentity } from './domainStore.js';
import type { StoredDomainResource } from './contracts.js';

export async function persistNativeConversation(accountSlot: string, value: unknown, resources: readonly StoredDomainResource[] = []): Promise<void> {
    const parsed = readParsedConversation(value);
    if (!parsed) return;
    await saveDomainConversation(accountSlot, parsed, resources);
}
export async function getDomainConversationView(accountSlot: string, id: string, providerId = 'gemini'): Promise<ParsedConversationView | null> {
    const stored = await getStoredDomain(storageIdentity(providerId, accountSlot, id));
    return stored ? createParsedConversationView(storedParseResult(stored)) : null;
}
