import type { DomainConversation } from '../domain/conversation.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../domain/conversationIndex.js';
import { selectConversationBody, type TrustedDomainBody } from '../domain/runtimeValidation.js';
import type { ResourceAcquisitionHints } from '../resources/resourceAcquisition.js';
import type { DomainStorageIdentity, TrustedDomainStorageRecord } from './domain/contracts.js';
import { domainStorageKey, storageIdentity } from './domain/domainStore.js';

export interface ConversationScope { readonly providerId: string; readonly accountSlot: string }

/** Persistence evidence accompanies the aggregate; it never becomes source metadata. */
export interface StoredConversation extends Omit<DomainConversation, 'detail'> {
    detail?: TrustedDomainBody;
    capture?: { revision: string; savedAt?: number; acquisitionHints: ResourceAcquisitionHints };
}

export interface ConversationRepository {
    readonly scope: ConversationScope;
    getConversation(id: string): Promise<StoredConversation | null>;
    getConversationIndex(id: string): Promise<DomainConversationIndex | null>;
}

interface ReadPorts {
    readIndexes(): Promise<readonly DomainConversationIndex[]>;
    readBody(identity: DomainStorageIdentity): Promise<TrustedDomainStorageRecord | null>;
    /** Storage supplies its existing conversation lock; no nested write is allowed. */
    readConsistently<T>(read: () => Promise<T>): Promise<T>;
}

/** Local reads only: no fetching, read repair, orphan promotion or swallowed I/O errors. */
export function createConversationRepository(scope: ConversationScope, ports: ReadPorts): ConversationRepository {
    if (!scope.providerId || scope.providerId !== scope.providerId.trim()
        || !scope.accountSlot || scope.accountSlot !== scope.accountSlot.trim()) throw new TypeError('Invalid conversation scope');
    const normalized = storageIdentity(scope.providerId, scope.accountSlot, 'scope');
    const boundScope = Object.freeze({ providerId: normalized.providerId, accountSlot: normalized.accountSlot });
    const identityFor = (id: string) => {
        if (typeof id !== 'string' || !id.trim() || id !== id.trim()) throw new TypeError('Invalid conversation ID');
        const identity = storageIdentity(boundScope.providerId, boundScope.accountSlot, id);
        if (!identity.conversationId.trim()) throw new TypeError('Invalid conversation ID');
        return identity;
    };
    const readIndex = async (identity: DomainStorageIdentity): Promise<DomainConversationIndex | null> => {
        const rows = await ports.readIndexes();
        const matches = rows.filter(row => row.providerId === identity.providerId && row.id === identity.conversationId);
        if (matches.length > 1) throw new TypeError('Duplicate conversation identity');
        return matches.length ? restoreConversationIndex(matches[0]) : null;
    };
    const getConversation = (id: string): Promise<StoredConversation | null> => ports.readConsistently(async () => {
        const identity = identityFor(id);
        const index = await readIndex(identity);
        if (!index) return null;
        const stored = await ports.readBody(identity);
        if (!stored) return { index };
        if (stored.key !== domainStorageKey(identity) || domainStorageKey(stored.identity) !== stored.key
            || stored.conversation.index.providerId !== identity.providerId
            || storageIdentity(identity.providerId, identity.accountSlot, stored.conversation.index.id).conversationId !== identity.conversationId) {
            throw new TypeError('Conversation body identity mismatch');
        }
        return structuredClone({ index, detail: selectConversationBody(stored.conversation),
            capture: { revision: stored.revision, acquisitionHints: stored.acquisitionHints,
            ...(stored.savedAt !== undefined ? { savedAt: stored.savedAt } : {}) } });
    });
    return Object.freeze({ scope: boundScope,
        getConversationIndex: (id: string) => ports.readConsistently(() => readIndex(identityFor(id))),
        getConversation,
    });
}
