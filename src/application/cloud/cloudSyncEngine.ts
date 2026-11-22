import type { CloudVaultClient, VaultRecordClient } from '../../l1/cloud/vaultClient.js';
import { getInitializedVaultKeyMetadata, putCloudSyncSession } from '../../l3a/vaultStorageService.js';
import { getSettings, updateSettings } from '../settings/index.js';
import { createVaultConnection } from './vaultConnection.js';
import { createVaultKeyRotation } from './vaultKeyRotation.js';
import { createVaultPullSync } from './vaultPullSync.js';
import { createVaultPushSync } from './vaultPushSync.js';
import {
    withVaultOperation,
    type ActivateKeyring,
    type AutoEnqueueSuppression,
    type CloudFlushResult,
    type CloudPullResult,
    type CloudSyncEngine,
} from './vaultShared.js';

export type { CloudVaultBackendType, CloudSyncStatusSnapshot, CloudSyncEngine } from './vaultShared.js';

export function createCloudSyncEngine(deps: {
    readonly client?: CloudVaultClient;
    readonly localFolderClient?: VaultRecordClient;
    readonly now?: () => number;
} = {}): CloudSyncEngine & { activateVaultKeyring: ActivateKeyring } {
    const now = deps.now ?? Date.now;
    const backgroundTasks = new Set<Promise<void>>();
    let suppressAutoEnqueueDepth = 0;
    let activeSyncNow: Promise<{ pull: CloudPullResult; push: CloudFlushResult }> | null = null;

    const trackBackground = (task: Promise<void>): void => {
        backgroundTasks.add(task);
        void task.finally(() => { backgroundTasks.delete(task); });
    };

    const suppression: AutoEnqueueSuppression = {
        isSuppressed: () => suppressAutoEnqueueDepth > 0,
        async withSuppressed<T>(work: () => Promise<T>): Promise<T> {
            suppressAutoEnqueueDepth++;
            try { return await work(); }
            finally { suppressAutoEnqueueDepth--; }
        },
    };

    const connection = createVaultConnection({
        client: deps.client,
        localFolderClient: deps.localFolderClient,
        now,
    });
    const pullSync = createVaultPullSync({ connection, suppression, now });
    const pushSync = createVaultPushSync({
        connection,
        suppression,
        now,
        trackBackground,
        isSyncNowActive: () => activeSyncNow !== null,
    });
    const keyRotation = createVaultKeyRotation({
        connection,
        pullChanges: pullSync.pullChanges,
        now,
    });

    const waitForIdle = async (): Promise<void> => {
        while (backgroundTasks.size > 0 || pushSync.getActiveFlush() !== null || pullSync.getActivePull() !== null) {
            const pending: Promise<unknown>[] = [...backgroundTasks];
            const activeFlush = pushSync.getActiveFlush();
            const activePull = pullSync.getActivePull();
            if (activeFlush) pending.push(activeFlush.catch(() => {}));
            if (activePull) pending.push(activePull.catch(() => {}));
            await Promise.allSettled(pending);
        }
    };

    const syncNow = (signal?: AbortSignal): Promise<{ pull: CloudPullResult; push: CloudFlushResult }> => {
        if (activeSyncNow) return activeSyncNow;
        const runSyncBody = async () => {
            const pull = await pullSync.pullChanges(signal);
            const settings = await getSettings();
            if (settings.cloudSyncEnabled) {
                await pushSync.enqueueUnsyncedLocalConversations();
            }
            const push = await pushSync.flushOutbox(signal);
            return { pull, push };
        };
        activeSyncNow = (async () => {
            try { return await withVaultOperation(runSyncBody); }
            finally { activeSyncNow = null; }
        })();
        return activeSyncNow;
    };

    return {
        connectLocalFolderVault: connection.connectLocalFolderVault,
        connectCloudVault: connection.connectCloudVault,
        disconnect: connection.disconnect,

        async setAutoSyncEnabled(enabled) {
            await withVaultOperation(async () => {
                if (enabled) {
                    const session = await connection.requireActiveSession();
                    connection.requireCompatibleKey(session, await getInitializedVaultKeyMetadata());
                    if (session.enabledSinceAt === undefined) {
                        await putCloudSyncSession({ ...session, enabledSinceAt: now() });
                    }
                }
                await updateSettings({ cloudSyncEnabled: enabled });
            });
            if (enabled) {
                trackBackground(syncNow().then(() => undefined).catch(err => {
                    console.warn('[CloudSync] Automatic bidirectional sync failed:', err);
                }));
            }
        },

        async setIncludeDetail(includeDetail) {
            await withVaultOperation(() => updateSettings({ cloudSyncIncludeDetail: includeDetail }));
            if (includeDetail) {
                const settings = await getSettings();
                if (settings.cloudSyncEnabled) {
                    trackBackground(
                        pushSync.enqueueUnsyncedLocalConversations()
                            .then(() => withVaultOperation(() => pushSync.flushOutbox()))
                            .then(() => undefined)
                            .catch(err => console.warn('[CloudSync] Detail upgrade sync failed:', err)),
                    );
                }
            }
        },

        enqueueAllExistingHistory: pushSync.enqueueUnsyncedLocalConversations,
        flushOutbox: signal => withVaultOperation(() => pushSync.flushOutbox(signal)),
        pullChanges: signal => withVaultOperation(() => pullSync.pullChanges(signal)),
        syncNow,
        getStatusSnapshot: connection.getStatusSnapshot,
        activateVaultKeyring: keyRotation.activateVaultKeyring,
        resetVaultWithCurrentKey: connection.resetVaultWithCurrentKey,
        reconcilePostToggleAccount: pushSync.reconcilePostToggleAccount,
        installAutoEnqueueListener: pushSync.installAutoEnqueueListener,
        waitForIdle,
    };
}

export const { activateVaultKeyring: activateDefaultVaultKeyring, ...defaultCloudSyncEngine } = createCloudSyncEngine();
