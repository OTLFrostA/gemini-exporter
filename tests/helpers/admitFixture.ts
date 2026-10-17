import { ingestDetail } from '../../src/core/domain/ingestion.js';
import { cacheAcquiredResources } from '../../src/core/storage/domain/resourceContext.js';
import { getDomainConversationResult } from '../../src/core/storage/domain/nativePersistence.js';
import { storageIdentity, deleteDetail } from '../../src/core/storage/domain/domainStore.js';
import { clearResourceContext } from '../../src/core/storage/domain/resourceContext.js';
import type { DomainStorageIdentity, StoredDomainResource } from '../../src/core/storage/domain/contracts.js';
import type { DomainFixture } from './domainFixture.js';

/** Fixture setup uses exactly the production fact admission contract. */
export async function admitFixture(accountId: string | null | undefined, parsed: DomainFixture,
    resources: readonly StoredDomainResource[] = [], canCommit?: () => boolean): Promise<DomainFixture> {
    if (!accountId || parsed.account.id !== accountId) throw new TypeError('Detail account/provider mismatch');
    if (canCommit?.() === false) throw new Error('Account changed before admission');
    const { index, detail } = parsed.conversation;
    await ingestDetail(accountId, index.key.conversationId,
        { ...detail, ...(parsed.sourceVersion !== undefined ? { savedAt: parsed.sourceVersion } : {}) }, index);
    const identity = storageIdentity(parsed.account.providerId, accountId, index.key.conversationId);
    await cacheAcquiredResources(identity, detail.assets, parsed.acquisitionHints, resources);
    const result = await getDomainConversationResult(accountId, identity.conversationId, identity.providerId);
    if (!result) throw new Error('Fixture Detail missing');
    return result;
}
export async function admitFixtures(accountId: string | null | undefined, parsed: readonly DomainFixture[]): Promise<void> {
    for (const item of parsed) await admitFixture(accountId, item);
}
export async function readFixture(identity: DomainStorageIdentity): Promise<DomainFixture | null> {
    return getDomainConversationResult(identity.accountId, identity.conversationId, identity.providerId);
}
export async function removeFixture(identity: DomainStorageIdentity): Promise<void> {
    await deleteDetail(identity); await clearResourceContext(identity);
}
