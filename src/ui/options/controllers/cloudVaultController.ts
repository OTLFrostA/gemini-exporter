import {
    defaultCloudSyncEngine,
    type CloudSyncStatusSnapshot,
    type CloudVaultBackendType,
} from '../../../application/cloud/cloudSyncEngine.js';
import { getSettings } from '../../../application/settings/index.js';
import { pickVaultDirectoryHandle, reauthorizeVaultDirectoryHandle } from '../../../runtime/capabilities/vaultFolderAuth.js';
import { OperationError } from '../../../shared/errors/operationError.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { errorText, text } from '../../shared/settings.js';
import type { UiMessage } from '../state/foregroundTask.js';

function formatCloudTargetLabel(snap: CloudSyncStatusSnapshot | null): string {
    if (!snap) return '';
    if (snap.email) return snap.email;
    let hostPart = '';
    if (snap.serverUrl && !snap.serverUrl.startsWith('local-vault://')) {
        try {
            hostPart = new URL(snap.serverUrl).host;
        } catch {
            hostPart = snap.serverUrl;
        }
    }
    const shortFp = snap.ownerSubject?.startsWith('vault:')
        ? `#${snap.ownerSubject.slice('vault:'.length, 'vault:'.length + 8)}`
        : (snap.ownerSubject ?? '');
    if (hostPart && shortFp) return `☁️ ${hostPart} (${shortFp})`;
    return hostPart ? `☁️ ${hostPart}` : shortFp;
}

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
    const accessCodeInput = control('input', 'cloudAccessCodeInput');
    const btnConnect = control('button', 'btnCloudConnect');
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
    const keyMismatchBox = el('cloudKeyMismatchBox');
    const btnResetVault = control('button', 'btnCloudResetVault');
    const btnCloseModal = control('button', 'btnCloudModalClose');
    const modalFeedback = el('cloudModalFeedback');

    let externalBusy = false;
    let internalBusy = false;
    let keyRevealed = false;
    let resetArmed = false;
    let selectedTab: CloudVaultBackendType = 'local-folder';
    let userPickedTab = false;
    let latestSnapshot: CloudSyncStatusSnapshot | null = null;
    let cachedRecoveryKey: string | null = null;

    const unsubscribeAutoEnqueue = defaultCloudSyncEngine.installAutoEnqueueListener();

    const silentAutoSync = async (): Promise<void> => {
        const snap = await defaultCloudSyncEngine.getStatusSnapshot();
        if (!snap.enabled || !snap.connected || snap.folderPermissionRequired || snap.keyMismatch) return;
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
                'Choose a local folder or connect a Cloud Vault server to enable auto E2EE backup',
                '选择本地文件夹或连接云同步服务器开启自动加密备份',
            );
        } else if (snap?.backend === 'local-folder' && snap.folderPermissionRequired) {
            summaryEl.textContent = text(
                `Folder "${snap.folderName ?? ''}" needs permission — click Manage to re-authorize`,
                `加密文件夹“${snap.folderName ?? ''}”需重新授权 — 请点击“管理”`,
            );
        } else if (snap?.keyMismatch) {
            summaryEl.textContent = text(
                'Key mismatch (paused) — click Manage to import original Recovery Key',
                '密钥不匹配（已暂停防覆盖）— 请点击“管理”导入原恢复密钥',
            );
        } else {
            const targetDesc = snap?.backend === 'local-folder'
                ? `📁 ${snap.folderName ?? 'Local Vault'}`
                : formatCloudTargetLabel(snap);
            const queuePart = (snap?.pendingOutbox ?? 0) > 0
                ? text(` · ${snap?.pendingOutbox} queued`, ` · ${snap?.pendingOutbox} 条待同步`)
                : '';
            const statePart = snap?.enabled
                ? text('Auto-sync ON', '自动同步中')
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
        accessCodeInput.disabled = disabled || isCloudConnected;
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
        keyMismatchBox.hidden = !(connected && snap?.keyMismatch);
        btnResetVault.disabled = disabled || !connected;
        btnResetVault.textContent = resetArmed
            ? text('Confirm Erase & Reset Vault', '确认清空旧密文并重置')
            : text('Reset Vault with Current Key', '用当前密钥重置保险箱');

        if (connected) {
            connectedLabel.textContent = activeBackend === 'local-folder'
                ? `📁 ${snap?.folderName ?? ''}`
                : formatCloudTargetLabel(snap);
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
        if (!accessCodeInput.value && settings.cloudSyncAccessCode) {
            accessCodeInput.value = settings.cloudSyncAccessCode;
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
            await refresh().catch(() => {});
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            const msg = errorText(error);
            setModalFeedback(msg, true);
            if (error instanceof OperationError && error.code === 'CLOUD_KEY_MISMATCH') {
                importKeyInput.focus();
            }
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
        resetArmed = false;
        void refresh().then(() => {
            if (isDialog(modal) && !modal.open) modal.showModal();
            if (latestSnapshot?.keyMismatch) importKeyInput.focus();
        });
    };

    const onCloseModal = (): void => {
        keyRevealed = false;
        resetArmed = false;
        if (isDialog(modal) && modal.open) modal.close();
        paint();
    };

    const onConnectCloud = (): void => {
        void runAction(async () => {
            const serverUrl = serverInput.value.trim();
            const accessCode = accessCodeInput.value.trim() || undefined;
            if (!serverUrl) {
                setModalFeedback(text('Enter your Cloud Vault server URL', '请填写云同步服务器地址'), true);
                return;
            }
            const connected = await defaultCloudSyncEngine.connectCloudVault(serverUrl, accessCode);
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
        resetArmed = false;
        void runAction(async () => {
            const imported = await defaultCloudSyncEngine.importRecoveryKey(candidate);
            cachedRecoveryKey = await defaultCloudSyncEngine.exportRecoveryKey();
            importKeyInput.value = '';
            const synced = await runSyncAndNotify();
            setModalFeedback(imported.resolution === 'rekeyed'
                ? text(
                    `Switched Master Key & re-encrypted vault · Saved ${synced.saved} conversations`,
                    `已切换为新恢复密钥并重新加密同步（保存 ${synced.saved} 条会话）`,
                )
                : text(
                    `Recovery key verified · Restored ${synced.restored}, Saved ${synced.saved}`,
                    `恢复密钥已验证解锁并完成同步（恢复 ${synced.restored} 条，保存 ${synced.saved} 条）`,
                ));
        });
    };

    const onResetVault = (): void => {
        if (!resetArmed) {
            resetArmed = true;
            paint();
            return;
        }
        resetArmed = false;
        void runAction(async () => {
            await defaultCloudSyncEngine.resetVaultWithCurrentKey();
            const synced = await runSyncAndNotify();
            setModalFeedback(text(
                `Vault reset with current key · Saved ${synced.saved} conversations`,
                `已使用当前浏览器密钥重置保险箱并备份 ${synced.saved} 条会话`,
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
    btnResetVault.addEventListener('click', onResetVault);

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
            btnResetVault.removeEventListener('click', onResetVault);
        },
    };
}
