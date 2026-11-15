import { defaultCloudSyncEngine, type CloudSyncStatusSnapshot } from '../../../application/cloud/cloudSyncEngine.js';
import { getSettings, updateSettings } from '../../../application/settings/index.js';
import { launchGoogleOidcIdTokenFlow } from '../../../runtime/capabilities/googleCloudAuth.js';
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

    const serverInput = control('input', 'cloudServerUrlInput');
    const clientIdInput = control('input', 'cloudGoogleClientIdInput');
    const btnConnect = control('button', 'btnCloudConnectGoogle');
    const btnDisconnect = control('button', 'btnCloudDisconnect');
    const connectedRow = el('cloudConnectedAccountRow');
    const connectedLabel = el('cloudConnectedEmail');
    const actionsSection = el('cloudConnectedActions');
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
        toggle.checked = Boolean(snap?.enabled && snap.connected);
        toggle.disabled = disabled || !snap?.connected;
        btnManage.disabled = disabled;

        if (!snap?.connected) {
            summaryEl.textContent = text(
                'Sign in with Google to enable zero-knowledge E2EE backup',
                '登录 Google 开启零知识端到端加密自动备份',
            );
        } else {
            const who = snap.email ?? snap.ownerSubject ?? '';
            const queuePart = snap.pendingOutbox > 0
                ? text(` · ${snap.pendingOutbox} queued`, ` · ${snap.pendingOutbox} 条待传`)
                : '';
            const statePart = snap.enabled
                ? text('Auto-sync ON', '自动同步已开启')
                : text('Paused', '已暂停');
            summaryEl.textContent = `${statePart}${who ? ' · ' + who : ''}${queuePart}`;
        }

        const connected = Boolean(snap?.connected);
        connectedRow.hidden = !connected;
        actionsSection.hidden = !connected;
        btnConnect.hidden = connected;
        serverInput.disabled = disabled || connected;
        clientIdInput.disabled = disabled || connected;
        btnConnect.disabled = disabled;
        btnDisconnect.disabled = disabled;
        btnSyncNow.disabled = disabled || !connected;
        btnBackfill.disabled = disabled || !connected;
        btnRevealKey.disabled = disabled || !cachedRecoveryKey;
        btnCopyKey.disabled = disabled || !cachedRecoveryKey;
        btnImportKey.disabled = disabled || !connected;
        importKeyInput.disabled = disabled || !connected;

        if (connected) {
            connectedLabel.textContent = snap?.email ?? snap?.ownerSubject ?? '';
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
        if (!serverInput.value && (snap.serverUrl ?? settings.cloudSyncServerUrl)) {
            serverInput.value = snap.serverUrl ?? settings.cloudSyncServerUrl ?? '';
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
            const msg = errorText(error);
            setModalFeedback(msg, true);
            callbacks.onStatus(() => errorText(error), 'error');
        } finally {
            internalBusy = false;
            paint();
        }
    };

    const onToggleChange = (): void => {
        const desired = toggle.checked;
        void runAction(async () => {
            await defaultCloudSyncEngine.setAutoSyncEnabled(desired);
            callbacks.onStatus(() => desired
                ? text('E2EE automatic cloud sync enabled', '已开启端到端加密自动云同步')
                : text('E2EE automatic cloud sync paused', '已暂停端到端加密自动云同步'));
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

    const onConnect = (): void => {
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
            setModalFeedback(text('Disconnected from Cloud Vault', '已断开云同步连接'));
            callbacks.onStatus(() => text('Cloud Sync disconnected', '已断开云同步'));
        });
    };

    const onSyncNow = (): void => {
        void runAction(async () => {
            const outcome = await defaultCloudSyncEngine.syncNow();
            if (outcome.pull.changed > 0) {
                await callbacks.onRestored();
            }
            const msg = text(
                `Sync complete · Restored ${outcome.pull.accepted}, Uploaded ${outcome.push.uploaded}`,
                `云同步完成 · 恢复 ${outcome.pull.accepted} 条，上传 ${outcome.push.uploaded} 条`,
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
                `Queued ${count} local conversations · Uploaded ${pushed.uploaded}`,
                `已扫描 ${count} 条本地历史会话 · 新增上传 ${pushed.uploaded} 条`,
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

    toggle.addEventListener('change', onToggleChange);
    btnManage.addEventListener('click', onOpenModal);
    btnCloseModal.addEventListener('click', onCloseModal);
    btnConnect.addEventListener('click', onConnect);
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
            toggle.removeEventListener('change', onToggleChange);
            btnManage.removeEventListener('click', onOpenModal);
            btnCloseModal.removeEventListener('click', onCloseModal);
            btnConnect.removeEventListener('click', onConnect);
            btnDisconnect.removeEventListener('click', onDisconnect);
            btnSyncNow.removeEventListener('click', onSyncNow);
            btnBackfill.removeEventListener('click', onBackfill);
            btnRevealKey.removeEventListener('click', onRevealKey);
            btnCopyKey.removeEventListener('click', onCopyKey);
            btnImportKey.removeEventListener('click', onImportKey);
        },
    };
}
