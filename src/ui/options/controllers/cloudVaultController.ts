import {
    defaultCloudSyncEngine,
    type CloudSyncStatusSnapshot,
    type CloudVaultBackendType,
} from '../../../application/cloud/cloudSyncEngine.js';
import { getSettings, updateSettings } from '../../../application/settings/index.js';
import { launchGoogleOidcIdTokenFlow } from '../../../runtime/capabilities/googleCloudAuth.js';
import { pickVaultDirectoryHandle, reauthorizeVaultDirectoryHandle } from '../../../runtime/capabilities/vaultFolderAuth.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { errorText, text } from '../../shared/settings.js';
import type { UiMessage } from '../state/foregroundTask.js';

export interface CloudVaultControllerHandle {
    refresh(): Promise<void>;
    onDomainChanged(accountId: string): void;
    setBusy(busy: boolean): void;
    unmount(): void;
}

export function mountCloudVaultPanel(callbacks: {
    readonly onStatus: (message: UiMessage, level?: 'info' | 'warn' | 'error') => void;
    readonly onRestored: () => Promise<void>;
}): CloudVaultControllerHandle {
    const toggle = control('input', 'cloudSyncToggle');
    const btnManage = control('button', 'btnCloudVaultSetup');
    const summaryEl = el('cloudVaultSummary');
    const modal = el('cloudVaultModal');
    const isDialog = (node: HTMLElement): node is HTMLDialogElement => 'showModal' in node;

    const btnTabLocal = control('button', 'btnVaultTabLocal');
    const btnTabCloud = control('button', 'btnVaultTabCloud');
    const panelLocal = el('vaultPanelLocal');
    const panelCloud = el('vaultPanelCloud');
    const btnLocalPick = control('button', 'btnLocalVaultPick');
    const btnLocalReauth = control('button', 'btnLocalVaultReauth');
    const btnLocalChangeDir = control('button', 'btnLocalVaultChangeDir');

    const serverInput = control('input', 'cloudServerUrlInput');
    const clientIdInput = control('input', 'cloudGoogleClientIdInput');
    const btnConnect = control('button', 'btnCloudConnectGoogle');
    const btnDisconnect = control('button', 'btnCloudDisconnect');
    const connectedRow = el('cloudConnectedAccountRow');
    const connectedLabel = el('cloudConnectedEmail');
    const actionsSection = el('cloudConnectedActions');
    const includeDetailToggle = control('input', 'cloudIncludeDetailToggle');
    const btnSyncNow = control('button', 'btnCloudSyncNow');
    const keyDisplay = control('input', 'cloudRecoveryKeyDisplay');
    const btnRevealKey = control('button', 'btnCloudRevealKey');
    const btnCopyKey = control('button', 'btnCloudCopyKey');
    const importKeyInput = control('input', 'cloudImportKeyInput');
    const btnImportKey = control('button', 'btnCloudImportKey');
    const btnCloseModal = control('button', 'btnCloudModalClose');
    const modalFeedback = el('cloudModalFeedback');

    let externalBusy = false;
    let internalBusy = false;
    let keyRevealed = false;
    let selectedTab: CloudVaultBackendType = 'local-folder';
    let userPickedTab = false;
    let latestSnapshot: CloudSyncStatusSnapshot | null = null;
    let cachedRecoveryKey: string | null = null;

    const unsubscribeAutoEnqueue = defaultCloudSyncEngine.installAutoEnqueueListener();

    const silentAutoSync = async (): Promise<void> => {
        const snap = await defaultCloudSyncEngine.getStatusSnapshot();
        if (!snap.enabled || !snap.connected || snap.folderPermissionRequired) return;
        const outcome = await defaultCloudSyncEngine.syncNow();
        if (outcome.pull.changed > 0) {
            await callbacks.onRestored();
        }
        await refresh();
    };

    const onOnline = (): void => { void silentAutoSync().catch(() => {}); };
    const onWindowFocus = (): void => { void silentAutoSync().catch(() => {}); };
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onWindowFocus);

    const setModalFeedback = (msg: string, isError = false): void => {
        modalFeedback.textContent = msg;
        modalFeedback.hidden = !msg;
        modalFeedback.dataset.error = isError ? 'true' : 'false';
    };

    const paint = (): void => {
        const disabled = externalBusy || internalBusy;
        const snap = latestSnapshot;
        const connected = Boolean(snap?.connected);
        const activeBackend: CloudVaultBackendType = snap?.backend ?? selectedTab;
        const viewingTab: CloudVaultBackendType = connected ? activeBackend : selectedTab;

        btnTabLocal.setAttribute('aria-selected', String(viewingTab === 'local-folder'));
        btnTabCloud.setAttribute('aria-selected', String(viewingTab === 'cloud-server'));
        btnTabLocal.disabled = disabled || (connected && activeBackend !== 'local-folder');
        btnTabCloud.disabled = disabled || (connected && activeBackend !== 'cloud-server');

        panelLocal.hidden = viewingTab !== 'local-folder';
        panelCloud.hidden = viewingTab !== 'cloud-server';

        toggle.checked = Boolean(snap?.enabled && connected);
        toggle.disabled = disabled || !connected;
        btnManage.disabled = disabled;

        if (!connected) {
            summaryEl.textContent = text(
                'Choose a local folder or sign in to Cloud Vault to enable auto E2EE backup',
                '选择本地文件夹或登录云端开启零知识自动加密备份',
            );
        } else if (snap?.backend === 'local-folder' && snap.folderPermissionRequired) {
            summaryEl.textContent = text(
                `Folder "${snap.folderName ?? ''}" needs permission — click Manage to re-authorize`,
                `加密文件夹“${snap.folderName ?? ''}”需重新授权 — 请点击“管理”`,
            );
        } else {
            const targetDesc = snap?.backend === 'local-folder'
                ? `📁 ${snap.folderName ?? 'Local Vault'}`
                : (snap?.email ?? snap?.ownerSubject ?? '');
            const queuePart = (snap?.pendingOutbox ?? 0) > 0
                ? text(` · ${snap?.pendingOutbox} queued`, ` · ${snap?.pendingOutbox} 条待同步`)
                : '';
            const modePart = snap?.includeDetail
                ? text('Full', '含正文')
                : text('Index-only', '仅目录');
            const statePart = snap?.enabled
                ? text(`Auto-sync (${modePart})`, `自动加密 (${modePart})`)
                : text('Paused', '已暂停');
            summaryEl.textContent = `${statePart}${targetDesc ? ' · ' + targetDesc : ''}${queuePart}`;
        }

        const isLocalConnected = connected && activeBackend === 'local-folder';
        const needsLocalReauth = isLocalConnected && Boolean(snap?.folderPermissionRequired);
        btnLocalPick.hidden = isLocalConnected;
        btnLocalReauth.hidden = !needsLocalReauth;
        btnLocalChangeDir.hidden = !isLocalConnected;
        btnLocalPick.disabled = disabled;
        btnLocalReauth.disabled = disabled;
        btnLocalChangeDir.disabled = disabled;

        const isCloudConnected = connected && activeBackend === 'cloud-server';
        btnConnect.hidden = isCloudConnected;
        serverInput.disabled = disabled || isCloudConnected;
        clientIdInput.disabled = disabled || isCloudConnected;
        btnConnect.disabled = disabled;

        connectedRow.hidden = !connected;
        actionsSection.hidden = !connected;
        includeDetailToggle.checked = Boolean(snap?.includeDetail);
        includeDetailToggle.disabled = disabled || !connected;
        btnDisconnect.disabled = disabled;
        btnSyncNow.disabled = disabled || !connected || needsLocalReauth;
        btnRevealKey.disabled = disabled || !cachedRecoveryKey;
        btnCopyKey.disabled = disabled || !cachedRecoveryKey;
        btnImportKey.disabled = disabled || !connected;
        importKeyInput.disabled = disabled || !connected;

        if (connected) {
            connectedLabel.textContent = activeBackend === 'local-folder'
                ? `📁 ${snap?.folderName ?? ''}`
                : (snap?.email ?? snap?.ownerSubject ?? '');
        }
        if (cachedRecoveryKey) {
            keyDisplay.value = keyRevealed ? cachedRecoveryKey : 'GEK1-•••••-•••••-•••••-•••••-•••••';
        } else {
            keyDisplay.value = '';
        }
        btnRevealKey.textContent = keyRevealed ? text('Hide', '隐藏') : text('Show', '显示');
    };

    const refresh = async (): Promise<void> => {
        const [snap, settings, key] = await Promise.all([
            defaultCloudSyncEngine.getStatusSnapshot(),
            getSettings(),
            defaultCloudSyncEngine.exportRecoveryKey(),
        ]);
        latestSnapshot = snap;
        cachedRecoveryKey = key;
        if (snap.connected && snap.backend && !userPickedTab) {
            selectedTab = snap.backend;
        }
        if (!serverInput.value && snap.backend !== 'local-folder' && (snap.serverUrl ?? settings.cloudSyncServerUrl)) {
            const candidate = snap.serverUrl ?? settings.cloudSyncServerUrl ?? '';
            if (!candidate.startsWith('local-vault://')) serverInput.value = candidate;
        }
        if (!clientIdInput.value && settings.cloudSyncGoogleClientId) {
            clientIdInput.value = settings.cloudSyncGoogleClientId;
        }
        paint();
    };

    const runSyncAndNotify = async (): Promise<{ restored: number; saved: number }> => {
        const outcome = await defaultCloudSyncEngine.syncNow();
        if (outcome.pull.changed > 0) {
            await callbacks.onRestored();
        }
        return { restored: outcome.pull.accepted, saved: outcome.push.uploaded };
    };

    const runAction = async (work: () => Promise<void>): Promise<void> => {
        if (internalBusy || externalBusy) return;
        internalBusy = true;
        setModalFeedback('');
        paint();
        try {
            await work();
            await refresh();
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            const msg = errorText(error);
            setModalFeedback(msg, true);
            callbacks.onStatus(() => errorText(error), 'error');
        } finally {
            internalBusy = false;
            paint();
        }
    };

    const onSelectTab = (tab: CloudVaultBackendType): void => {
        if (latestSnapshot?.connected) return;
        selectedTab = tab;
        userPickedTab = true;
        setModalFeedback('');
        paint();
    };

    const onPickLocalFolder = (): void => {
        if (internalBusy || externalBusy) return;
        const pickerPromise = pickVaultDirectoryHandle();
        void runAction(async () => {
            const handle = await pickerPromise;
            const connected = await defaultCloudSyncEngine.connectLocalFolderVault(handle);
            cachedRecoveryKey = connected.recoveryKey;
            await defaultCloudSyncEngine.setAutoSyncEnabled(true);
            const synced = await runSyncAndNotify();
            setModalFeedback(text(
                `Local Vault "${handle.name}" active · Restored ${synced.restored}, Saved ${synced.saved}. Updates now sync automatically.`,
                `本地加密文件夹“${handle.name}”已启用并完成同步（恢复 ${synced.restored} 条，加密保存 ${synced.saved} 条），后续变更自动同步。`,
            ));
            callbacks.onStatus(() => text(
                `E2EE Vault "${handle.name}" synced (Restored ${synced.restored}, Saved ${synced.saved})`,
                `加密保险箱“${handle.name}”已同步（恢复 ${synced.restored} 条，保存 ${synced.saved} 条）`,
            ));
        });
    };

    const onReauthLocalFolder = (): void => {
        if (internalBusy || externalBusy) return;
        const reauthPromise = reauthorizeVaultDirectoryHandle();
        void runAction(async () => {
            const handle = await reauthPromise;
            const synced = await runSyncAndNotify();
            setModalFeedback(text(
                `Folder "${handle.name}" re-authorized · Restored ${synced.restored}, Saved ${synced.saved}`,
                `文件夹“${handle.name}”已重新授权并完成同步（恢复 ${synced.restored} 条，加密保存 ${synced.saved} 条）`,
            ));
        });
    };

    const onToggleChange = (): void => {
        const desired = toggle.checked;
        void runAction(async () => {
            await defaultCloudSyncEngine.setAutoSyncEnabled(desired);
            if (desired) {
                const synced = await runSyncAndNotify();
                callbacks.onStatus(() => text(
                    `E2EE auto-sync enabled · Restored ${synced.restored}, Saved ${synced.saved}`,
                    `已开启自动加密同步（恢复 ${synced.restored} 条，保存 ${synced.saved} 条）`,
                ));
            } else {
                callbacks.onStatus(() => text('E2EE automatic sync paused', '已暂停端到端加密自动同步'));
            }
        });
    };

    const onOpenModal = (): void => {
        setModalFeedback('');
        keyRevealed = false;
        void refresh().then(() => {
            if (isDialog(modal) && !modal.open) modal.showModal();
        });
    };

    const onCloseModal = (): void => {
        keyRevealed = false;
        if (isDialog(modal) && modal.open) modal.close();
        paint();
    };

    const onConnectCloud = (): void => {
        void runAction(async () => {
            const serverUrl = serverInput.value.trim();
            const googleClientId = clientIdInput.value.trim();
            if (!serverUrl) {
                setModalFeedback(text('Enter your Cloud Vault HTTPS URL', '请填写云同步服务器 HTTPS 地址'), true);
                return;
            }
            if (!googleClientId) {
                setModalFeedback(text('Enter your Google OAuth Client ID', '请填写 Google OAuth Client ID'), true);
                return;
            }
            await updateSettings({ cloudSyncServerUrl: serverUrl, cloudSyncGoogleClientId: googleClientId });
            const idToken = await launchGoogleOidcIdTokenFlow(googleClientId);
            const connected = await defaultCloudSyncEngine.connectWithGoogleIdToken(serverUrl, idToken);
            cachedRecoveryKey = connected.recoveryKey;
            await defaultCloudSyncEngine.setAutoSyncEnabled(true);
            const synced = await runSyncAndNotify();
            setModalFeedback(text(
                `Connected & synced · Restored ${synced.restored}, Saved ${synced.saved}. Updates now sync automatically.`,
                `云端连接并完成同步（恢复 ${synced.restored} 条，加密保存 ${synced.saved} 条），后续变更自动同步。`,
            ));
            callbacks.onStatus(() => text('Connected & synced with E2EE Cloud Vault', '已连接端到端加密云保险箱并完成同步'));
        });
    };

    const onDisconnect = (): void => {
        void runAction(async () => {
            await defaultCloudSyncEngine.disconnect({ revokeRemoteTokens: false });
            cachedRecoveryKey = null;
            keyRevealed = false;
            userPickedTab = false;
            setModalFeedback(text('Disconnected from Encrypted Vault', '已断开加密保险箱连接'));
            callbacks.onStatus(() => text('Encrypted Vault disconnected', '已断开加密保险箱'));
        });
    };

    const onSyncNow = (): void => {
        void runAction(async () => {
            const synced = await runSyncAndNotify();
            const msg = text(
                `Sync complete · Restored ${synced.restored}, Saved ${synced.saved}`,
                `同步完成 · 恢复 ${synced.restored} 条，加密保存 ${synced.saved} 条`,
            );
            setModalFeedback(msg);
            callbacks.onStatus(() => msg);
        });
    };

    const onRevealKey = (): void => {
        keyRevealed = !keyRevealed;
        paint();
    };

    const onCopyKey = (): void => {
        if (!cachedRecoveryKey) return;
        void navigator.clipboard.writeText(cachedRecoveryKey).then(() => {
            setModalFeedback(text('Recovery key copied to clipboard', '恢复密钥已复制到剪贴板'));
        }).catch(() => {
            keyRevealed = true;
            paint();
            keyDisplay.select();
        });
    };

    const onImportKey = (): void => {
        const candidate = importKeyInput.value.trim();
        if (!candidate) return;
        void runAction(async () => {
            await defaultCloudSyncEngine.importRecoveryKey(candidate);
            importKeyInput.value = '';
            const synced = await runSyncAndNotify();
            setModalFeedback(text(
                `Recovery key verified · Restored ${synced.restored}, Saved ${synced.saved}`,
                `恢复密钥校验通过并已自动同步（恢复 ${synced.restored} 条，保存 ${synced.saved} 条）`,
            ));
        });
    };

    const onIncludeDetailChange = (): void => {
        const desired = includeDetailToggle.checked;
        void runAction(async () => {
            await defaultCloudSyncEngine.setIncludeDetail(desired);
            if (desired && latestSnapshot?.enabled) {
                const synced = await runSyncAndNotify();
                setModalFeedback(text(
                    `Full message body backup enabled · Upgraded ${synced.saved} conversations`,
                    `已开启完整聊天正文加密备份 · 已自动加密同步 ${synced.saved} 条会话`,
                ));
            } else {
                setModalFeedback(desired
                    ? text('Full message body backup enabled', '已开启完整聊天正文加密备份')
                    : text('Switched to privacy-minimal Index-only mode', '已切换为隐私最小化的仅目录（Index）同步模式'));
            }
        });
    };

    const selectLocal = () => onSelectTab('local-folder');
    const selectCloud = () => onSelectTab('cloud-server');

    btnTabLocal.addEventListener('click', selectLocal);
    btnTabCloud.addEventListener('click', selectCloud);
    btnLocalPick.addEventListener('click', onPickLocalFolder);
    btnLocalChangeDir.addEventListener('click', onPickLocalFolder);
    btnLocalReauth.addEventListener('click', onReauthLocalFolder);
    toggle.addEventListener('change', onToggleChange);
    includeDetailToggle.addEventListener('change', onIncludeDetailChange);
    btnManage.addEventListener('click', onOpenModal);
    btnCloseModal.addEventListener('click', onCloseModal);
    btnConnect.addEventListener('click', onConnectCloud);
    btnDisconnect.addEventListener('click', onDisconnect);
    btnSyncNow.addEventListener('click', onSyncNow);
    btnRevealKey.addEventListener('click', onRevealKey);
    btnCopyKey.addEventListener('click', onCopyKey);
    btnImportKey.addEventListener('click', onImportKey);

    void refresh().then(() => silentAutoSync()).catch(() => {});

    return {
        refresh,
        onDomainChanged(changedAccountId: string) {
            void defaultCloudSyncEngine.reconcilePostToggleAccount(changedAccountId)
                .then(() => refresh())
                .catch(() => {});
        },
        setBusy(busy: boolean) {
            externalBusy = busy;
            paint();
        },
        unmount() {
            unsubscribeAutoEnqueue();
            window.removeEventListener('online', onOnline);
            window.removeEventListener('focus', onWindowFocus);
            btnTabLocal.removeEventListener('click', selectLocal);
            btnTabCloud.removeEventListener('click', selectCloud);
            btnLocalPick.removeEventListener('click', onPickLocalFolder);
            btnLocalChangeDir.removeEventListener('click', onPickLocalFolder);
            btnLocalReauth.removeEventListener('click', onReauthLocalFolder);
            toggle.removeEventListener('change', onToggleChange);
            includeDetailToggle.removeEventListener('change', onIncludeDetailChange);
            btnManage.removeEventListener('click', onOpenModal);
            btnCloseModal.removeEventListener('click', onCloseModal);
            btnConnect.removeEventListener('click', onConnectCloud);
            btnDisconnect.removeEventListener('click', onDisconnect);
            btnSyncNow.removeEventListener('click', onSyncNow);
            btnRevealKey.removeEventListener('click', onRevealKey);
            btnCopyKey.removeEventListener('click', onCopyKey);
            btnImportKey.removeEventListener('click', onImportKey);
        },
    };
}
