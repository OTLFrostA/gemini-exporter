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
    const btnBackfill = control('button', 'btnCloudBackfill');
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
    const onOnline = (): void => {
        void defaultCloudSyncEngine.flushOutbox().then(() => refresh()).catch(() => {});
    };
    const onWindowFocus = (): void => {
        void defaultCloudSyncEngine.flushOutbox().then(() => refresh()).catch(() => {});
    };
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
        btnBackfill.disabled = disabled || !connected || needsLocalReauth;
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
        // CRITICAL: Invoke native directory picker synchronously inside the user click gesture!
        const pickerPromise = pickVaultDirectoryHandle();
        void runAction(async () => {
            const handle = await pickerPromise;
            const connected = await defaultCloudSyncEngine.connectLocalFolderVault(handle);
            cachedRecoveryKey = connected.recoveryKey;
            await defaultCloudSyncEngine.setAutoSyncEnabled(true);
            setModalFeedback(connected.createdNewKey
                ? text(
                    `Local Vault "${handle.name}" active! Master Key generated — copy your recovery key for safe keeping.`,
                    `本地加密文件夹“${handle.name}”已启用！已生成主密钥，建议复制保存恢复密钥。`,
                )
                : text(
                    `Local Vault "${handle.name}" active! Existing Master Key loaded.`,
                    `本地加密文件夹“${handle.name}”已启用！已自动加载主密钥。`,
                ));
            callbacks.onStatus(() => text(
                `Auto-encrypting new conversations to "${handle.name}"`,
                `已开启自动加密保存至本地文件夹“${handle.name}”`,
            ));
        });
    };

    const onReauthLocalFolder = (): void => {
        if (internalBusy || externalBusy) return;
        const reauthPromise = reauthorizeVaultDirectoryHandle();
        void runAction(async () => {
            const handle = await reauthPromise;
            const flushed = await defaultCloudSyncEngine.flushOutbox();
            setModalFeedback(text(
                `Folder "${handle.name}" re-authorized · Flushed ${flushed.uploaded} queued conversations`,
                `文件夹“${handle.name}”已重新授权 · 已自动补写 ${flushed.uploaded} 条待同步会话`,
            ));
        });
    };

    const onToggleChange = (): void => {
        const desired = toggle.checked;
        void runAction(async () => {
            await defaultCloudSyncEngine.setAutoSyncEnabled(desired);
            callbacks.onStatus(() => desired
                ? text('E2EE automatic sync enabled', '已开启端到端加密自动同步')
                : text('E2EE automatic sync paused', '已暂停端到端加密自动同步'));
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
            setModalFeedback(connected.createdNewKey
                ? text(
                    'Connected! Master Key generated & synced to Chrome. Copy your recovery key as an offline backup.',
                    '连接成功！已生成主密钥并同步至 Chrome，请复制保存恢复密钥以备跨浏览器使用。',
                )
                : text(
                    'Connected! Existing Master Key automatically restored.',
                    '连接成功！已自动恢复您的端到端加密主密钥。',
                ));
            callbacks.onStatus(() => text('Connected to E2EE Cloud Vault', '已连接端到端加密云存储'));
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
            const outcome = await defaultCloudSyncEngine.syncNow();
            if (outcome.pull.changed > 0) {
                await callbacks.onRestored();
            }
            const msg = text(
                `Sync complete · Restored ${outcome.pull.accepted}, Saved ${outcome.push.uploaded}`,
                `加密同步完成 · 解密恢复 ${outcome.pull.accepted} 条，加密写入 ${outcome.push.uploaded} 条`,
            );
            setModalFeedback(msg);
            callbacks.onStatus(() => msg);
        });
    };

    const onBackfill = (): void => {
        void runAction(async () => {
            const count = await defaultCloudSyncEngine.enqueueAllExistingHistory();
            const pushed = await defaultCloudSyncEngine.flushOutbox();
            const msg = text(
                `Queued ${count} local conversations · Saved ${pushed.uploaded} encrypted records`,
                `已扫描 ${count} 条本地历史会话 · 新增写入 ${pushed.uploaded} 条密文`,
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
            setModalFeedback(text('Recovery key imported and verified!', '恢复密钥校验通过并已导入！'));
        });
    };

    const onIncludeDetailChange = (): void => {
        const desired = includeDetailToggle.checked;
        void runAction(async () => {
            await defaultCloudSyncEngine.setIncludeDetail(desired);
            setModalFeedback(desired
                ? text('Full message body backup enabled for future updates', '已开启完整聊天正文加密备份（对后续更新生效）')
                : text('Switched to privacy-minimal Index-only mode', '已切换为隐私最小化的仅目录（Index）同步模式'));
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
    btnBackfill.addEventListener('click', onBackfill);
    btnRevealKey.addEventListener('click', onRevealKey);
    btnCopyKey.addEventListener('click', onCopyKey);
    btnImportKey.addEventListener('click', onImportKey);

    void refresh().catch(() => {});

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
            btnBackfill.removeEventListener('click', onBackfill);
            btnRevealKey.removeEventListener('click', onRevealKey);
            btnCopyKey.removeEventListener('click', onCopyKey);
            btnImportKey.removeEventListener('click', onImportKey);
        },
    };
}
