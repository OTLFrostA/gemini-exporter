import type { ConversationKey } from '../../l2/conversationKey.js';
import { provideDomainStorage } from '../../l2/storagePort.js';
import {
    getAccount,
    admitAccountAtomically,
    updateIndexesAtomically,
    updateConversationAtomically,
    deleteStoredConversation,
    getCoverage,
    updateCoverageAtomically,
    getSourceCooldown,
    extendSourceCooldown,
} from '../../l3a/storageService.js';
import {
    getConversationSnapshot,
    updateConversationsAtomically,
} from '../../l3a/batchStorageService.js';

type CommittedKeysListener = (keys: readonly ConversationKey[]) => void;
const committedKeysListeners = new Set<CommittedKeysListener>();

export function subscribeCommittedKeys(listener: CommittedKeysListener): () => void {
    committedKeysListeners.add(listener);
    return () => { committedKeysListeners.delete(listener); };
}

function emitCommittedKeys(keys: readonly ConversationKey[]): void {
    if (keys.length === 0 || committedKeysListeners.size === 0) return;
    for (const listener of committedKeysListeners) {
        try {
            listener(keys);
        } catch (error) {
            console.warn('[Runtime] Committed keys listener failed:', error);
        }
    }
}

export function installDomainStorage(): void {
    provideDomainStorage({
        getAccount,
        admitAccountAtomically,
        getConversationSnapshot,
        updateIndexesAtomically,
        updateConversationAtomically,
        updateConversationsAtomically,
        deleteStoredConversation,
        getCoverage,
        updateCoverageAtomically,
        getSourceCooldown,
        extendSourceCooldown,
        onCommittedKeys: emitCommittedKeys,
    });
}
