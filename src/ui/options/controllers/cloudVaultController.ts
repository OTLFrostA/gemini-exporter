import {
    defaultCloudSyncEngine,
    type CloudSyncStatusSnapshot,
    type CloudVaultBackendType,
} from '../../../application/vault/cloudSyncEngine.js';
import { commitOneTimeVaultKey, prepareOneTimeVaultKey } from '../../../application/vault/vaultKeySetup.js';
import { getSettings } from '../../../application/settings/index.js';
import { pickVaultDirectoryHandle, reauthorizeVaultDirectoryHandle } from '../../../runtime/capabilities/vaultFolderAuth.js';
import { OperationError } from '../../../shared/errors/operationError.js';
import type { CloudAuthKeyMode } from '../../../shared/types/cloudSync.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { errorText, text } from '../../shared/settings.js';
import type { UiMessage } from '../state/foregroundTask.js';

function formatCloudTargetLabel(snap: CloudSyncStatusSnapshot | null): string {
    if (!snap) return '';
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

    const keyLockedRow = el('vaultKeyLockedRow');
    const keyFingerprintLabel = el('vaultKeyFingerprintLabel');
    const btnToggleRekey = control('button', 'btnToggleRekey');
    const keySetupBox = el('vaultKeySetupBox');
    const btnGenerateOneTimeKey = control('button', 'btnGenerateOneTimeKey');
    const oneTimeDraftPanel = el('oneTimeDraftPanel');
    const keyDisplay = control('input', 'cloudRecoveryKeyDisplay');
    const btnCopyKey = control('button', 'btnCloudCopyKey');
    const btnConfirmOneTimeKey = control('button', 'btnConfirmOneTimeKey');
    const importKeyInput = control('input', 'cloudImportKeyInput');
    const btnImportKey = control('button', 'btnCloudImportKey');

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
    const btnCreateRemoteVault = control('button', 'btnCloudCreateRemoteVault');
    const btnDisconnect = control('button', 'btnCloudDisconnect');
    const connectedRow = el('cloudConnectedAccountRow');
    const connectedLabel = el('cloudConnectedTarget');
    const actionsSection = el('cloudConnectedActions');
    const includeDetailRow = el('cloudIncludeDetailRow');
    const includeDetailToggle = control('input', 'cloudIncludeDetailToggle');
    const btnSyncNow = control('button', 'btnCloudSyncNow');
    const keyMismatchBox = el('cloudKeyMismatchBox');
    const keyMismatchText = el('cloudKeyMismatchText');
    const resetRow = el('cloudVaultResetRow');
    const btnResetVault = control('button', 'btnCloudResetVault');
    const btnCloseModal = control('button', 'btnCloudModalClose');
    const modalFeedback = el('cloudModalFeedback');

    let externalBusy = false;
    let internalBusy = false;
    let resetArmed = false;
    let rekeyExpanded = false;
    let offerExplicitCreate = false;
    let ephemeralOneTimeDraft: { value: string; expectedFingerprint: string | null } | null = null;
    let selectedTab: CloudVaultBackendType = 'local-folder';
    let userPickedTab = false;
    let latestSnapshot: CloudSyncStatusSnapshot | null = null;
    let modalGeneration = 0;
    let mounted = true;

    const wipeEphemeralKeyInputs = (): void => {
        ephemeralOneTimeDraft = null;
        keyDisplay.value = '';
        importKeyInput.value = '';
        oneTimeDraftPanel.hidden = true;
    };

    const unsubscribeAutoEnqueue = defaultCloudSyncEngine.installAutoEnqueueListener();

    let silentSyncInFlight = false;
    const silentAutoSync = async (): Promise<void> => {
        if (!mounted || externalBusy || internalBusy || silentSyncInFlight) return;
        silentSyncInFlight = true;
        try {
            const snap = await defaultCloudSyncEngine.getStatusSnapshot();
            if (!mounted || externalBusy || internalBusy) return;
            if (!snap.enabled || !snap.connected || !snap.hasRecoveryKey || snap.folderPermissionRequired || snap.keyMismatch) return;
            const outcome = await defaultCloudSyncEngine.syncNow();
            if (!mounted) return;
            if (outcome.pull.changed > 0) {
                await callbacks.onRestored();
            }
            if (mounted) await refresh();
        } finally {
            silentSyncInFlight = false;
        }
    };

    const onOnline = (): void => { void silentAutoSync().catch(() => {}); };
    const onWindowFocus = (): void => { void silentAutoSync().catch(() => {}); };
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onWindowFocus);

    const setModalFeedback = (msg: string, isError = false): void => {
        if (!mounted) return;
        modalFeedback.textContent = msg;
        modalFeedback.hidden = !msg;
        modalFeedback.dataset.error = isError ? 'true' : 'false';
    };

    const paint = (): void => {
        const disabled = externalBusy || internalBusy;
        const snap = latestSnapshot;
        const connected = Boolean(snap?.connected);
        const hasKey = Boolean(snap?.hasRecoveryKey);
        const activeBackend: CloudVaultBackendType = snap?.backend ?? selectedTab;
        const viewingTab: CloudVaultBackendType = connected ? activeBackend : selectedTab;

        const shortKeyFp = snap?.keyFingerprint ? `#${snap.keyFingerprint.slice(0, 8)}` : '';
        keyLockedRow.hidden = !hasKey;
        if (hasKey) {
            keyFingerprintLabel.textContent = text(
                `🔑 Master Key stored in this browser (${shortKeyFp})`,
                `🔑 主密钥已保存在此浏览器（${shortKeyFp}）`,
            );
        }
        btnToggleRekey.disabled = disabled;
        btnToggleRekey.textContent = rekeyExpanded
            ? text('Cancel', '收起')
            : text('Change Key', '更换密钥');

        const showKeySetup = !hasKey || rekeyExpanded || Boolean(snap?.keyMismatch);
        keySetupBox.hidden = !showKeySetup;
        oneTimeDraftPanel.hidden = !ephemeralOneTimeDraft;
        keyDisplay.value = ephemeralOneTimeDraft?.value ?? '';
        btnGenerateOneTimeKey.hidden = false;
        btnGenerateOneTimeKey.disabled = disabled;
        btnCopyKey.disabled = disabled || !ephemeralOneTimeDraft;
        btnConfirmOneTimeKey.disabled = disabled || !ephemeralOneTimeDraft;
        importKeyInput.disabled = disabled;
        btnImportKey.disabled = disabled;

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
                'Encrypted cross-device DB sync (not readable export)',
                '跨设备加密同步本地数据库（非可读文档导出）',
            );
        } else if (snap?.backend === 'local-folder' && snap.folderPermissionRequired) {
            summaryEl.textContent = text(
                `Folder "${snap.folderName ?? ''}" needs permission — click Manage to re-authorize`,
                `加密文件夹“${snap.folderName ?? ''}”需重新授权 — 请点击“管理”`,
            );
        } else if (snap?.keyMismatch) {
            summaryEl.textContent = text(
                'Key mismatch (paused) — click Manage to enter original Master Key',
                '密钥不匹配（已暂停防覆盖）— 请点击“管理”输入原主密钥',
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
        btnLocalPick.disabled = disabled || !hasKey;
        btnLocalReauth.disabled = disabled;
        btnLocalChangeDir.disabled = disabled || !hasKey;

        const isCloudConnected = connected && activeBackend === 'cloud-server';
        const willAutoCreate = snap?.keyOrigin === 'generated';
        btnConnect.hidden = isCloudConnected;
        btnConnect.textContent = willAutoCreate
            ? text('Create & Connect Cloud Vault', '新建并连接云端保险箱')
            : text('Unlock Existing Cloud Vault', '解锁已有云端保险箱');
        btnCreateRemoteVault.hidden = isCloudConnected || willAutoCreate || !offerExplicitCreate;
        serverInput.disabled = disabled || isCloudConnected;
        accessCodeInput.disabled = disabled || isCloudConnected;
        btnConnect.disabled = disabled || !hasKey;
        btnCreateRemoteVault.disabled = disabled || !hasKey;

        const showKeyMismatch = Boolean(connected && snap?.keyMismatch);
        const showCloudReset = connected && activeBackend === 'cloud-server' && !showKeyMismatch;
        const showLocalReset = connected && activeBackend === 'local-folder' && showKeyMismatch;
        const showIncludeDetailRow = !includeDetailRow.hidden;
        connectedRow.hidden = !connected;
        actionsSection.hidden = !connected || (!showKeyMismatch && !showIncludeDetailRow && !showCloudReset);
        includeDetailToggle.checked = Boolean(snap?.includeDetail);
        includeDetailToggle.disabled = disabled || !connected;
        btnDisconnect.disabled = disabled;
        btnSyncNow.disabled = disabled || !connected || needsLocalReauth;
        keyMismatchBox.hidden = !showKeyMismatch;
        if (showKeyMismatch) {
            keyMismatchText.textContent = activeBackend === 'cloud-server'
                ? text('Import the original Master Key to resume access to this cloud vault.', '请导入原主密钥，恢复此云端保险箱的访问。')
                : text('This folder uses a different key. Import the original Master Key or reset the folder with the current key.', '此文件夹使用另一把密钥。请导入原主密钥，或用当前密钥重置文件夹。');
        }
        resetRow.hidden = !showCloudReset && !showLocalReset;
        btnResetVault.disabled = disabled || !connected;
        btnResetVault.textContent = showCloudReset
            ? (resetArmed ? text('Confirm Clear Cloud Backup', '确认清空云端备份') : text('Clear Cloud Backup', '清空云端备份'))
            : (resetArmed ? text('Confirm Erase & Reset Vault', '确认清空旧密文并重置') : text('Reset Vault with Current Key', '用当前密钥重置保险箱'));

        if (connected) {
            connectedLabel.textContent = activeBackend === 'local-folder'
                ? `📁 ${snap?.folderName ?? ''}`
                : formatCloudTargetLabel(snap);
        }
    };

    const refresh = async (): Promise<void> => {
        const [snap, settings] = await Promise.all([
            defaultCloudSyncEngine.getStatusSnapshot(),
            getSettings(),
        ]);
        if (!mounted) return;
        latestSnapshot = snap;
        if (snap.connected && snap.backend && !userPickedTab) {
            selectedTab = snap.backend;
        }
        if (!serverInput.value && snap.backend !== 'local-folder' && (snap.serverUrl ?? settings.cloudSyncServerUrl)) {
            const candidate = snap.serverUrl ?? settings.cloudSyncServerUrl ?? '';
            if (!candidate.startsWith('local-vault://')) serverInput.value = candidate;
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
            if (error instanceof OperationError && error.code === 'CLOUD_VAULT_NOT_FOUND') {
                offerExplicitCreate = true;
            }
            setModalFeedback(msg, true);
            if (isDialog(modal) && modal.open && error instanceof OperationError && error.code === 'CLOUD_KEY_MISMATCH') {
                rekeyExpanded = true;
                paint();
                importKeyInput.focus();
            }
            callbacks.onStatus(() => errorText(error), 'error');
        } finally {
            internalBusy = false;
            if (mounted) paint();
        }
    };

    const onSelectTab = (tab: CloudVaultBackendType): void => {
        if (latestSnapshot?.connected) return;
        selectedTab = tab;
        userPickedTab = true;
        setModalFeedback('');
        paint();
    };

    const onToggleRekey = (): void => {
        rekeyExpanded = !rekeyExpanded;
        if (!rekeyExpanded) wipeEphemeralKeyInputs();
        paint();
    };

    const onGenerateOneTimeKey = (): void => {
        const generation = modalGeneration;
        const expectedFingerprint = latestSnapshot?.keyFingerprint ?? null;
        void runAction(async () => {
            const draft = await prepareOneTimeVaultKey();
            if (mounted && generation === modalGeneration) ephemeralOneTimeDraft = { value: draft, expectedFingerprint };
        });
    };

    const onCopyKey = (): void => {
        if (!ephemeralOneTimeDraft) return;
        const generation = modalGeneration;
        void navigator.clipboard.writeText(ephemeralOneTimeDraft.value).then(() => {
            if (generation === modalGeneration) {
                setModalFeedback(text('Master Key copied — save it offline, then click Lock below', '主密钥已复制 — 请妥善离线保存后点击下方锁定'));
            }
        }).catch(() => {
            if (generation === modalGeneration) keyDisplay.select();
        });
    };

    const applyCommittedKey = async (rawKey: string, origin: 'generated' | 'imported', expectedFingerprint: string | null): Promise<void> => {
        resetArmed = false;
        offerExplicitCreate = false;
        const committing = commitOneTimeVaultKey(rawKey, origin, expectedFingerprint);
        rawKey = '';
        const res = await committing;
        rekeyExpanded = false;
        if (res.resolution === 'initialized') {
            setModalFeedback(latestSnapshot?.connected
                ? text(
                    `New Master Key stored (#${res.keyFingerprint.slice(0, 8)}). Click "Reset Vault with Current Key" below if the previous key was lost.`,
                    `新主密钥已保存（#${res.keyFingerprint.slice(0, 8)}）。若原密钥已遗失，请点击下方“用当前密钥重置保险箱”。`,
                )
                : text(
                    `Master Key stored in this browser (#${res.keyFingerprint.slice(0, 8)}). Now choose a folder or connect your server.`,
                    `主密钥已保存在此浏览器（#${res.keyFingerprint.slice(0, 8)}）。现在可选择文件夹或连接服务器。`,
                ));
            return;
        }
        const { cloudBackup } = res;
        if (cloudBackup?.restoredChanges) await callbacks.onRestored();
        if (res.resolution === 'rekeyed') {
            const saved = cloudBackup?.saved ?? (await runSyncAndNotify()).saved;
            setModalFeedback(text(
                `Rotated to new Master Key (#${res.keyFingerprint.slice(0, 8)}) · Saved ${saved} conversations`,
                `已轮换启用新主密钥（#${res.keyFingerprint.slice(0, 8)}）并重新加密同步 ${saved} 条会话`,
            ));
            return;
        }
        const synced = await runSyncAndNotify();
        setModalFeedback(text(
            `Master Key verified · Restored ${synced.restored}, Saved ${synced.saved}`,
            `主密钥已验证解锁并完成同步（恢复 ${synced.restored} 条，保存 ${synced.saved} 条）`,
        ));
    };

    const onConfirmOneTimeKey = (): void => {
        const draft = ephemeralOneTimeDraft;
        if (!draft) return;
        void runAction(() => {
            wipeEphemeralKeyInputs();
            return applyCommittedKey(draft.value, 'generated', draft.expectedFingerprint);
        });
    };

    const onImportKey = (): void => {
        const candidate = importKeyInput.value.trim();
        if (!candidate) return;
        void runAction(() => {
            wipeEphemeralKeyInputs();
            return applyCommittedKey(candidate, 'imported', latestSnapshot?.keyFingerprint ?? null);
        });
    };

    const onPickLocalFolder = (): void => {
        if (internalBusy || externalBusy) return;
        const pickerPromise = pickVaultDirectoryHandle();
        void runAction(async () => {
            const handle = await pickerPromise;
            await defaultCloudSyncEngine.connectLocalFolderVault(handle);
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
        clearModalState();
        const generation = modalGeneration;
        void refresh().then(() => {
            if (!mounted || generation !== modalGeneration) return;
            if (isDialog(modal) && !modal.open) modal.showModal();
            if (latestSnapshot?.keyMismatch) importKeyInput.focus();
        }).catch(() => {});
    };

    const clearModalState = (): void => {
        modalGeneration++;
        resetArmed = false;
        rekeyExpanded = false;
        offerExplicitCreate = false;
        accessCodeInput.value = '';
        wipeEphemeralKeyInputs();
    };

    const onCloseModal = (): void => {
        clearModalState();
        if (isDialog(modal) && modal.open) modal.close();
        paint();
    };
    const onDialogClosed = (): void => {
        if (!isDialog(modal) || !modal.open) clearModalState();
    };

    const connectCloudWithMode = (explicitMode?: CloudAuthKeyMode): void => {
        void runAction(async () => {
            const serverUrl = serverInput.value.trim();
            const accessCode = accessCodeInput.value.trim() || undefined;
            if (!serverUrl) {
                setModalFeedback(text('Enter your Cloud Vault server URL', '请填写云同步服务器地址'), true);
                return;
            }
            offerExplicitCreate = false;
            await defaultCloudSyncEngine.connectCloudVault(serverUrl, accessCode, explicitMode);
            accessCodeInput.value = '';
            await defaultCloudSyncEngine.setAutoSyncEnabled(true);
            const synced = await runSyncAndNotify();
            setModalFeedback(text(
                `Connected & synced · Restored ${synced.restored}, Saved ${synced.saved}. Updates now sync automatically.`,
                `云端连接并完成同步（恢复 ${synced.restored} 条，加密保存 ${synced.saved} 条），后续变更自动同步。`,
            ));
            callbacks.onStatus(() => text('Connected & synced with E2EE Cloud Vault', '已连接端到端加密云保险箱并完成同步'));
        });
    };

    const onConnectCloud = (): void => connectCloudWithMode();
    const onCreateCloudExplicit = (): void => connectCloudWithMode('create');

    const onDisconnect = (): void => {
        void runAction(async () => {
            await defaultCloudSyncEngine.disconnect();
            userPickedTab = false;
            offerExplicitCreate = false;
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

    const onResetVault = (): void => {
        if (!resetArmed) {
            resetArmed = true;
            paint();
            return;
        }
        resetArmed = false;
        void runAction(async () => {
            const isCloud = latestSnapshot?.backend === 'cloud-server';
            await defaultCloudSyncEngine.resetVaultWithCurrentKey();
            if (isCloud) {
                setModalFeedback(text(
                    'Cloud backup cleared. Local conversations are preserved. Automatic backup is paused.',
                    '已清空云端备份。本地会话已保留，自动备份已暂停。',
                ));
                return;
            }
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

    btnToggleRekey.addEventListener('click', onToggleRekey);
    btnGenerateOneTimeKey.addEventListener('click', onGenerateOneTimeKey);
    btnCopyKey.addEventListener('click', onCopyKey);
    btnConfirmOneTimeKey.addEventListener('click', onConfirmOneTimeKey);
    btnImportKey.addEventListener('click', onImportKey);
    btnTabLocal.addEventListener('click', selectLocal);
    btnTabCloud.addEventListener('click', selectCloud);
    btnLocalPick.addEventListener('click', onPickLocalFolder);
    btnLocalChangeDir.addEventListener('click', onPickLocalFolder);
    btnLocalReauth.addEventListener('click', onReauthLocalFolder);
    toggle.addEventListener('change', onToggleChange);
    includeDetailToggle.addEventListener('change', onIncludeDetailChange);
    btnManage.addEventListener('click', onOpenModal);
    btnCloseModal.addEventListener('click', onCloseModal);
    modal.addEventListener('cancel', clearModalState);
    modal.addEventListener('close', onDialogClosed);
    window.addEventListener('pagehide', clearModalState);
    btnConnect.addEventListener('click', onConnectCloud);
    btnCreateRemoteVault.addEventListener('click', onCreateCloudExplicit);
    btnDisconnect.addEventListener('click', onDisconnect);
    btnSyncNow.addEventListener('click', onSyncNow);
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
            mounted = false;
            clearModalState();
            unsubscribeAutoEnqueue();
            window.removeEventListener('online', onOnline);
            window.removeEventListener('focus', onWindowFocus);
            btnToggleRekey.removeEventListener('click', onToggleRekey);
            btnGenerateOneTimeKey.removeEventListener('click', onGenerateOneTimeKey);
            btnCopyKey.removeEventListener('click', onCopyKey);
            btnConfirmOneTimeKey.removeEventListener('click', onConfirmOneTimeKey);
            btnImportKey.removeEventListener('click', onImportKey);
            btnTabLocal.removeEventListener('click', selectLocal);
            btnTabCloud.removeEventListener('click', selectCloud);
            btnLocalPick.removeEventListener('click', onPickLocalFolder);
            btnLocalChangeDir.removeEventListener('click', onPickLocalFolder);
            btnLocalReauth.removeEventListener('click', onReauthLocalFolder);
            toggle.removeEventListener('change', onToggleChange);
            includeDetailToggle.removeEventListener('change', onIncludeDetailChange);
            btnManage.removeEventListener('click', onOpenModal);
            btnCloseModal.removeEventListener('click', onCloseModal);
            modal.removeEventListener('cancel', clearModalState);
            modal.removeEventListener('close', onDialogClosed);
            window.removeEventListener('pagehide', clearModalState);
            btnConnect.removeEventListener('click', onConnectCloud);
            btnCreateRemoteVault.removeEventListener('click', onCreateCloudExplicit);
            btnDisconnect.removeEventListener('click', onDisconnect);
            btnSyncNow.removeEventListener('click', onSyncNow);
            btnResetVault.removeEventListener('click', onResetVault);
        },
    };
}
