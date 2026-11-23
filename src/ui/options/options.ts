import { installApplicationHost } from '../../runtime/api/applicationHost.js';
import { installDomainStorage } from '../../runtime/api/domainStorage.js';
import { installProviderHost } from '../../runtime/api/providerHost.js';
import { observeDomainChanges } from '../../runtime/api/domainChanges.js';
import { ensureV2Ready } from '../../runtime/api/runtimeReady.js';
import * as Directory from '../../runtime/capabilities/dirHandleController.js';
import { resolveScanTarget } from '../../runtime/capabilities/tabService.js';
import { OperationError } from '../../shared/errors/operationError.js';
import { DIRECT_WRITE_THRESHOLD, FEEDBACK_URL } from '../../shared/utils/constants.js';
import { isAccountId } from '../../l2/accountRegistry.js';
import { warmLocalFontCache } from '../../application/export/fonts.js';
import * as Cleanup from '../../application/localCleanup.js';
import { createSourceResourceContext } from '../../application/resources.js';
import { updateSettings, type GlobalSettings } from '../../application/settings/index.js';
import { getLatestEligibleFeature } from '../guidance/featureReleases.js';
import { TourGuide, consumeTourIntent } from '../guidance/tourGuide.js';
import { conversationSourceSummary, type ConversationSourceSummary } from '../shared/conversationSourceSummary.js';
import { elementById as el, requiredElement as control } from '../shared/elements.js';
import { exportSummary } from '../shared/exportSummary.js';
import { showRatingPromptIfEligible } from '../shared/ratingPrompt.js';
import { readSettings } from '../shared/readSettings.js';
import { errorText, observeSettings, text } from '../shared/settings.js';
import { mountCloudVaultPanel, type CloudVaultControllerHandle } from './controllers/cloudVaultController.js';
import { createDiagnosticLogController, type LogLevel } from './controllers/diagnosticLogController.js';
import type { UIExportRequest } from './controllers/exportController.js';
import { runExportSession, type ExportRunDiagnostic } from './controllers/exportSession.js';
import { bindSettingsAndDeliveryControls } from './controllers/settingsAndDeliveryController.js';
import { handlePlatformArchiveImport } from './controllers/takeoutController.js';
import { createWorkbenchScanController } from './controllers/workbenchScanController.js';
import { ConversationViewState } from './state/conversationsStore.js';
import { ExportIssueCollector } from './state/exportIssues.js';
import type { ForegroundTask, TaskFeedback, UiMessage } from './state/foregroundTask.js';
import { confirmCleanup } from './views/cleanupPrompt.js';
import { showDirectWritePrompt } from './views/directWritePrompt.js';
import { copyExportFailures } from './views/exportFailures.js';
import { renderList, unmountList } from './views/listView.js';
import { mountTaskPanel } from './views/taskPanelView.js';
import { renderWorkbench, resolveSourceMessage, resolveUiMessage } from './views/workbenchView.js';

installDomainStorage();
installApplicationHost();
installProviderHost();

type Action = 'export' | 'takeout' | 'cleanup';

export async function initWorkbench(): Promise<void> {
    const installationTour = consumeTourIntent();
    const state = new ConversationViewState();
    const importedResources = createSourceResourceContext();
    let settings: GlobalSettings;
    let directoryAvailable = false;
    let foreground: ForegroundTask = { kind: 'idle' };
    const isBusy = () => foreground.kind !== 'idle';
    const taskPanel = mountTaskPanel();
    let cloudPanel: CloudVaultControllerHandle | undefined;
    let currentScanStatus: UiMessage | ConversationSourceSummary | null = null;
    let presentationSaving = false;
    let lastRequest: UIExportRequest | null = null;
    let failed: UIExportRequest['keys'] = [];
    let dismissedFailures = false;
    let currentIssues = new ExportIssueCollector();
    let folderSuggestionPending = false;
    const preparedExportKeys = new Set<string>();
    let feedback: TaskFeedback = { kind: 'empty' };
    let percent = 0;
    let settingsControls: ReturnType<typeof bindSettingsAndDeliveryControls> | undefined;

    const fileInput = control('input', 'takeoutFileInput');
    const importButton = control('button', 'btnImportTakeout');

    const showTakeout = (count: number) => TourGuide.showTakeoutPrompt(
        count,
        () => {},
        () => { fileInput.click(); },
        () => { window.open('https://takeout.google.com/settings/takeout/custom/gemini', '_blank', 'noopener,noreferrer'); },
        () => {
            settings = { ...settings, takeoutPromptCompleted: true };
            void updateSettings({ takeoutPromptCompleted: true }).catch(e => statusError(e));
        },
    );

    const logController = createDiagnosticLogController({
        state,
        onShowTakeout: showTakeout,
        onError: error => statusError(error),
    });

    const cancel = () => {
        if (foreground.kind !== 'export' || foreground.phase !== 'running') return;
        foreground = { ...foreground, phase: 'cancelling' };
        foreground.controller.abort();
        status(() => text('Cancelling…', '正在取消…'), 'warn');
    };
    const retryFailed = () => {
        if (isBusy() || !lastRequest || !failed.length) return;
        const fonts = lastRequest.format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
        void exportRequest({ ...lastRequest, keys: [...failed], skipUnchanged: false }, fonts);
    };
    const dismissFailures = () => { dismissedFailures = true; paintTaskPanel(); };
    const copyFailures = () => {
        void navigator.clipboard.writeText(copyExportFailures(currentIssues.groups())).catch(e => statusError(e));
    };

    const paintTaskPanel = () => {
        const scanState = scanRunner.getState();
        taskPanel.render({
            task: foreground,
            feedback,
            percent,
            scanning: scanRunner.isScanning(),
            scanMessage: currentScanStatus === null || (typeof currentScanStatus === 'object' && currentScanStatus.method !== 'sync')
                ? null : resolveSourceMessage(currentScanStatus, state, scanState.evidence),
            scanEvidence: scanState.evidence,
            scanSlow: scanState.slow,
            onTakeout: scanState.takeoutCount === undefined ? undefined : showTakeout.bind(undefined, scanState.takeoutCount),
            sourceSummary: currentScanStatus !== null && typeof currentScanStatus === 'object'
                ? { ...currentScanStatus, accountId: state.accountId, total: state.indexes.length } : undefined,
            groups: currentIssues.groups(),
            failedCount: failed.length,
            dismissed: dismissedFailures,
            developerMode: settings?.developerMode ?? false,
            ready: !!settings,
            onCancel: cancel,
            onRetry: retryFailed,
            onDismiss: dismissFailures,
            onCopy: copyFailures,
        });
    };

    const status = (message: UiMessage, level: LogLevel = 'info', rawLogMessage?: string) => {
        scanRunner.clearConnectionError();
        feedback = { kind: 'status', message, level };
        paintTaskPanel();
        logController.appendLog({ at: Date.now(), level, message: rawLogMessage ?? resolveUiMessage(message) });
    };
    const statusError = (error: unknown, level: LogLevel = 'error') =>
        status(() => errorText(error), level, error instanceof Error ? error.message : String(error));
    const reportScan = (message: UiMessage | ConversationSourceSummary, level: LogLevel = 'info', rawLogMessage?: string) => {
        if (level !== 'error') scanRunner.clearConnectionError();
        const scanState = scanRunner.getState();
        currentScanStatus = message;
        paintTaskPanel();
        logController.appendLog({
            at: Date.now(),
            level,
            message: rawLogMessage ?? resolveSourceMessage(message, state, scanState.evidence),
            takeoutCount: scanState.takeoutCount,
        });
    };
    const progress = (message: UiMessage, nextPercent?: number) => {
        if (foreground.kind === 'idle' || foreground.phase !== 'running' || foreground.controller.signal.aborted) return;
        feedback = { kind: 'progress', message };
        if (nextPercent !== undefined && Number.isFinite(nextPercent)) percent = Math.max(0, Math.min(100, nextPercent));
        paintTaskPanel();
    };
    const renderConversations = () => renderList(
        state,
        isBusy(),
        foreground.kind === 'export' ? preparedExportKeys : undefined,
        new Set(failed.filter(key => key.accountId === state.accountId).map(key => key.conversationId)),
        TourGuide.isGuidedSelection(),
    );
    const render = () => renderWorkbench({
        state,
        settings,
        busy: isBusy(),
        scanning: scanRunner.isScanning(),
        scanAborted: scanRunner.isScanAborted(),
        presentationSaving,
        themeSaving: settingsControls?.isThemeSaving() ?? false,
        directoryAvailable,
        folderSuggestionPending,
        onCloudBusy: busy => cloudPanel?.setBusy(busy),
        onRenderConversations: renderConversations,
        onPaintTaskPanel: paintTaskPanel,
    });

    const resetAccountEphemeralState = () => {
        lastRequest = null;
        failed = [];
        currentIssues = new ExportIssueCollector();
        dismissedFailures = false;
        currentScanStatus = null;
        scanRunner.resetAccountState();
        feedback = { kind: 'empty' };
    };

    const refresh = async (changedAccountId?: string) => {
        const priorAccountId = state.accountId;
        const changed = await state.refresh(changedAccountId);
        const implicitSwitch = priorAccountId !== null && state.accountId !== priorAccountId;
        if (implicitSwitch) resetAccountEphemeralState();
        if (changed || implicitSwitch) render();
        scanRunner.runAdvanceTutorialScan();
        const previousError = scanRunner.getState().connectionError;
        const accountId = state.accountId;
        if (!previousError || isBusy() || scanRunner.isScanning() || !accountId) return;
        try {
            const connected = await resolveScanTarget(accountId);
            if (connected === accountId && state.accountId === accountId && !isBusy() && !scanRunner.isScanning() && scanRunner.getState().connectionError === previousError) {
                reportScan(() => text('Account connected. Sync conversations to refresh history.', '账号已连接，可同步会话更新历史。'));
            }
        } catch { /* Keep actionable guidance until a verified Content source is available. */ }
    };

    const select = async (id: string) => {
        if (id !== state.accountId) resetAccountEphemeralState();
        state.selectAccount(id);
        render();
        await refresh();
    };

    const perform = async (kind: Action, task: (signal: AbortSignal) => Promise<void>) => {
        if (isBusy()) return;
        const taskController = new AbortController();
        foreground = { kind, phase: 'running', controller: taskController };
        feedback = { kind: 'empty' }; percent = 0;
        render();
        try { await task(taskController.signal); }
        catch (error) { statusError(error); }
        finally {
            foreground = { kind, phase: 'refreshing', controller: taskController };
            paintTaskPanel();
            try { await refresh(); } catch (error) { statusError(error); }
            foreground = { kind: 'idle' }; render();
        }
    };

    const scanRunner = createWorkbenchScanController({
        state,
        isBusy,
        setSettings: next => { settings = next; },
        clearFeedback: () => { feedback = { kind: 'empty' }; },
        recordScanRun: logController.recordScanRun,
        reportScan,
        showTakeout,
        select,
        refresh,
        render,
        paintTaskPanel,
        statusError,
    });

    const exportRequest = async (request: UIExportRequest, fonts: Promise<void>) => {
        if (isBusy()) return;
        const finishTutorialExport = TourGuide.beginExport();
        let tutorialExportSucceeded = false;
        let successfulExports = 0;
        await perform('export', async signal => {
            lastRequest = { ...request, keys: request.keys.map(key => ({ ...key })) };
            const run: ExportRunDiagnostic = {
                startedAt: Date.now(), request: lastRequest,
                items: [], diagnostics: [], issues: new ExportIssueCollector(), droppedDiagnostics: 0,
            };
            currentIssues = run.issues;
            logController.recordExportRun(run);
            const titleFor = (key: UIExportRequest['keys'][number] | undefined) => key
                && state.indexes.find(index => index.key.accountId === key.accountId
                    && index.key.conversationId === key.conversationId)?.title;
            failed = []; dismissedFailures = false; preparedExportKeys.clear(); render();
            const { result, deliveredCount } = await runExportSession(run, {
                signal,
                importedResources,
                titleFor,
                prepare: async () => {
                    await fonts;
                    if (request.delivery === 'folderWriter' && !await Directory.verifyDirPermission(Directory.getDirHandle())) {
                        throw new OperationError('DIRECTORY_PERMISSION_REQUIRED', 'Authorize a folder first');
                    }
                },
                onStart: status,
                onProgress: progress,
                onIssuesChanged: paintTaskPanel,
                onBodyDelivered: key => {
                    if (key.accountId === state.accountId) preparedExportKeys.delete(key.conversationId);
                    renderConversations();
                },
                onItemUpdate: update => {
                    if (update.status === 'failed' && !failed.some(key =>
                        key.accountId === update.key.accountId && key.conversationId === update.key.conversationId)) {
                        failed = [...failed, update.key];
                    }
                    if (update.status === 'exported') {
                        failed = failed.filter(key => key.accountId !== update.key.accountId || key.conversationId !== update.key.conversationId);
                    }
                    if (update.key.accountId === state.accountId) {
                        if (update.status === 'prepared') preparedExportKeys.add(update.key.conversationId);
                        else preparedExportKeys.delete(update.key.conversationId);
                        if (update.status === 'exported') state.records[update.key.conversationId] = update.record;
                    }
                    if (update.status !== 'skipped') renderConversations();
                },
            });
            successfulExports = result.exported - result.partial;
            tutorialExportSucceeded = !result.failed.length && !result.aborted && !result.partial;
            preparedExportKeys.clear();
            percent = 100;
            failed = [...result.failed];
            status(() => exportSummary(result) + (deliveredCount > result.exported
                ? text(`; Documents already delivered: ${deliveredCount}`, `；已交付正文 ${deliveredCount} 条，文件已保留`)
                : ''), failed.length || result.aborted || result.partial ? 'warn' : 'info');
        });
        finishTutorialExport?.(tutorialExportSucceeded);
        if (successfulExports > 0 && tutorialExportSucceeded) {
            void showRatingPromptIfEligible().catch(error => console.warn('[Rating prompt]', error));
        }
    };

    el('btnSyncAll').addEventListener('click', () => {
        if (scanRunner.isScanning()) scanRunner.stopScan();
        else void scanRunner.scan();
    });
    el('btnForceFullScan').addEventListener('click', () => { if (settings.developerMode) void scanRunner.scan(true); });
    el('btnExport').addEventListener('click', () => {
        const keys = TourGuide.isGuidedSelection() ? state.keys().slice(0, 1) : state.keys();
        if (isBusy() || folderSuggestionPending || !keys.length || !settings) return;
        const request: UIExportRequest = {
            keys, format: settings.defaultFormat, delivery: settings.exportDelivery ?? 'browserDownload',
            includeAssets: settings.includeAssets, skipUnchanged: settings.skipExported,
        };
        const start = (delivery: UIExportRequest['delivery']) => {
            const fonts = request.format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
            void exportRequest({ ...request, delivery }, fonts);
        };
        if (request.delivery === 'browserDownload' && keys.length > DIRECT_WRITE_THRESHOLD
            && !settings.directWritePromptCompleted && !TourGuide.isActive()) {
            const shown = showDirectWritePrompt(keys.length, () => {
                const permission = Directory.getPendingPermissionHandle()
                    ? Directory.reauthorizeDirHandle() : Directory.requestDirHandle();
                folderSuggestionPending = true; render();
                void (async () => {
                    try {
                        if (!await permission || !await Directory.verifyDirPermission(Directory.getDirHandle())) {
                            throw new OperationError('DIRECTORY_PERMISSION_DENIED', 'Folder permission denied');
                        }
                        directoryAvailable = true;
                        await updateSettings({ exportDelivery: 'folderWriter' });
                        settings = await readSettings(); render();
                        start('folderWriter');
                    } catch (error) { statusError(error, 'warn'); }
                    finally { folderSuggestionPending = false; render(); }
                })();
            }, () => start('browserDownload'));
            if (shown) {
                settings = { ...settings, directWritePromptCompleted: true };
                void updateSettings({ directWritePromptCompleted: true }).catch(error => statusError(error));
                return;
            }
        }
        start(request.delivery);
    });

    const importFile = (file: File) => {
        if (isBusy() || importButton.disabled) return;
        const accountId = state.accountId;
        const account = state.accounts.find(a => a.id === accountId);
        return perform('takeout', async () => {
            currentScanStatus = null;
            scanRunner.clearImportBannerState();
            try {
                const outcome = await handlePlatformArchiveImport(file, account, accountId, {
                    onStartKind: kind => status(() => kind === 'openai'
                        ? text('Importing OpenAI ZIP…', '正在导入 OpenAI ZIP…')
                        : text('Importing Takeout ZIP…', '正在导入 Takeout ZIP…')),
                    onTarget: select,
                    onProgress: pct => progress(() => text(`Importing ${pct}%`, `正在导入 ${pct}%`), pct),
                    resources: importedResources,
                });
                await refresh();
                if (outcome.kind === 'openai') {
                    const { result } = outcome;
                    currentScanStatus = { method: 'openai', status: result.status === 'partial' ? 'partial' : 'complete', read: result.read, added: result.added };
                    const summary = currentScanStatus;
                    if (result.status === 'empty') status(() => text(
                        'This OpenAI ZIP contains no conversation bodies. No conversations were imported.',
                        '此 OpenAI ZIP 没有聊天正文，未导入任何会话。'), 'warn');
                    else status(() => conversationSourceSummary(summary, state.indexes.length) + text(
                        `. Skipped ${result.skipped}; unavailable attachments ${result.missingAssets}.`,
                        `。跳过 ${result.skipped} 条；${result.missingAssets} 个附件不可用。`), result.status === 'partial' ? 'warn' : 'info');
                } else {
                    const { result } = outcome;
                    currentScanStatus = { method: 'takeout', status: result.status === 'ok' ? 'complete' : 'partial', read: result.imported, added: result.added };
                    const summary = currentScanStatus;
                    status(() => conversationSourceSummary(summary, state.indexes.length) + (result.status === 'partial'
                        ? text('. Some content or attachments are incomplete.', '。部分内容或附件不完整。') : ''), result.status === 'partial' ? 'warn' : 'info');
                }
            } finally { fileInput.value = ''; }
        });
    };
    importButton.addEventListener('click', () => { if (!isBusy() && !importButton.disabled) fileInput.click(); });
    fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void importFile(file); });
    importButton.addEventListener('dragover', event => event.preventDefault());
    importButton.addEventListener('drop', event => { event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file) void importFile(file); });

    for (const [id, scanRecords] of [['btnClearExported', false], ['btnClearScan', true]] as const) {
        el(id).addEventListener('click', async () => {
            const accountId = state.accountId;
            if (!accountId || isBusy() || scanRunner.isScanning()) return;
            const account = state.accounts.find(a => a.id === accountId);
            const name = account?.displayName || account?.email || account?.providerAccountId || accountId;
            if (!await confirmCleanup(scanRecords, name) || isBusy() || scanRunner.isScanning() || state.accountId !== accountId) return;
            void perform('cleanup', async () => {
                if (scanRecords) {
                    const keys = state.indexes.map(index => index.key);
                    await Cleanup.clearLocalScanRecords(accountId);
                    for (const key of keys) importedResources.releaseConversation(key);
                } else {
                    await Cleanup.clearLocalExportRecords(accountId);
                }
                failed = []; currentIssues = new ExportIssueCollector(); dismissedFailures = false;
                status(() => text('Records cleared', '记录已清除'));
            });
        });
    }

    control('select', 'accountIdSelect').addEventListener('change', () => {
        if (isBusy() || scanRunner.isScanning()) { render(); return; }
        void select(control('select', 'accountIdSelect').value).catch(e => statusError(e));
    });
    control('input', 'chatSearchInput').addEventListener('input', () => {
        state.search = control('input', 'chatSearchInput').value; renderConversations();
    });
    control('select', 'chatFilterSelect').addEventListener('change', () => {
        state.filter = control('select', 'chatFilterSelect').value; renderConversations();
    });
    control('button', 'btnShowHiddenSelection').addEventListener('click', () => {
        if (isBusy()) return;
        const search = control('input', 'chatSearchInput');
        const filter = control('select', 'chatFilterSelect');
        state.search = ''; state.filter = 'all'; search.value = ''; filter.value = 'all';
        renderConversations(); search.focus();
    });
    control('button', 'btnDeselectHidden').addEventListener('click', () => {
        if (isBusy()) return;
        for (const id of state.hiddenSelection()) state.selected.delete(id);
        renderConversations();
    });
    control('input', 'btnSelectAll').addEventListener('change', () => {
        if (isBusy() || TourGuide.isGuidedSelection()) return;
        if (control('input', 'btnSelectAll').checked) state.selectVisible();
        else state.selected.clear();
        renderConversations();
    });

    settingsControls = bindSettingsAndDeliveryControls({
        isBusy,
        getSettings: () => settings,
        setSettings: next => { settings = next; },
        isDirectoryAvailable: () => directoryAvailable,
        setDirectoryAvailable: next => { directoryAvailable = next; },
        setPresentationSaving: next => { presentationSaving = next; },
        isPresentationSaving: () => presentationSaving,
        performCleanup: task => perform('cleanup', task),
        render,
        status,
        statusError,
    });
    logController.bindControls();

    el('btnPlatformPermissions').addEventListener('click', () => {
        if (!isBusy() && !scanRunner.isScanning()) TourGuide.showPlatformAuthorization(select);
    });
    const prepareTourLiveSave = async () => {
        if (settings?.defaultFormat === 'markdown') return;
        try {
            await updateSettings({ defaultFormat: 'markdown' });
            settings = await readSettings();
            render();
        } catch (error) { statusError(error); throw error; }
    };
    const startWorkbenchTour = async () => {
        const firstSelected = state.selected.values().next().value;
        state.selected.clear();
        if (firstSelected !== undefined) state.selected.add(firstSelected);
        renderConversations();
        await TourGuide.startTour(select, prepareTourLiveSave);
    };
    el('btnTourGuide').addEventListener('click', () => { if (!isBusy() && !scanRunner.isScanning()) void startWorkbenchTour(); });

    const applyOpenedAccount = async (value: unknown) => {
        if (!isAccountId(value)) return;
        await chrome.storage.session.remove('openOptionsAccountId');
        if (isBusy() || scanRunner.isScanning()) return;
        if (!state.accounts.some(account => account.id === value)) await refresh();
        if (!isBusy() && !scanRunner.isScanning() && state.accounts.some(account => account.id === value)) await select(value);
    };
    const onOpenedAccountChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
        if (area === 'session' && changes.openOptionsAccountId) {
            void applyOpenedAccount(changes.openOptionsAccountId.newValue).catch(error => statusError(error));
        }
    };
    const stopSettings = observeSettings(() => {
        void readSettings().then(next => {
            const changed = !settings || ([
                'defaultFormat', 'skipExported', 'includeAssets', 'enabledDisk',
                'exportDelivery', 'developerMode', 'theme', 'language', 'cloudSyncEnabled',
            ] as const).some(field => settings[field] !== next[field]);
            settings = next;
            if (changed) {
                render();
                void cloudPanel?.refresh().catch(() => {});
            }
        }).catch(e => statusError(e));
    });
    const onFocus = () => {
        if (isBusy()) return;
        void (async () => {
            await refresh();
            const previous = directoryAvailable;
            try { directoryAvailable = await Directory.verifyDirPermission(Directory.getDirHandle()); }
            catch (error) { directoryAvailable = false; statusError(error, 'warn'); }
            if (directoryAvailable !== previous) render();
        })().catch(e => statusError(e));
    };
    const pendingDomainAccounts = new Set<string>();
    let domainRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    let domainRefreshing = false;
    const scheduleDomainRefresh = () => {
        if (!pendingDomainAccounts.size || domainRefreshTimer !== undefined || domainRefreshing) return;
        const delayMs = isBusy() || scanRunner.isScanning() ? 150 : 16;
        domainRefreshTimer = setTimeout(() => {
            domainRefreshTimer = undefined;
            domainRefreshing = true;
            void (async () => {
                while (pendingDomainAccounts.size) {
                    const accounts = [...pendingDomainAccounts]; pendingDomainAccounts.clear();
                    await refresh(accounts.includes(state.accountId ?? '') ? undefined : accounts[0]);
                    for (const accountId of accounts) cloudPanel?.onDomainChanged(accountId);
                }
            })().catch(e => statusError(e)).finally(() => {
                domainRefreshing = false;
                scheduleDomainRefresh();
            });
        }, delayMs);
    };
    const stopDomainChanges = observeDomainChanges(accountId => {
        pendingDomainAccounts.add(accountId);
        scheduleDomainRefresh();
    });

    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', () => {
        cloudPanel?.unmount();
        taskPanel.unmount();
        unmountList();
        importedResources.release();
        stopSettings(); stopDomainChanges(); chrome.storage.onChanged.removeListener(onOpenedAccountChange);
        clearTimeout(domainRefreshTimer); pendingDomainAccounts.clear();
        window.removeEventListener('focus', onFocus); TourGuide.destroy();
    }, { once: true });

    logController.renderLog(); render();
    await ensureV2Ready();
    settings = await readSettings();
    cloudPanel = mountCloudVaultPanel({
        onStatus: (msg, level) => status(msg, level),
        onRestored: async () => { await refresh(); },
    });
    logController.renderLog();
    await state.refresh(); render();
    chrome.storage.onChanged.addListener(onOpenedAccountChange);
    await applyOpenedAccount((await chrome.storage.session.get('openOptionsAccountId')).openOptionsAccountId);
    try {
        await Directory.restoreSavedDirHandle();
        directoryAvailable = await Directory.verifyDirPermission(Directory.getDirHandle());
    } catch (error) {
        directoryAvailable = false;
        status(() => text('Folder permission could not be restored: ', '无法恢复文件夹权限：') + errorText(error),
            'warn', 'Folder permission could not be restored: ' + (error instanceof Error ? error.message : String(error)));
    }
    render();
    if (installationTour) await startWorkbenchTour();
    else {
        const current = chrome.runtime.getManifest().version;
        const feature = getLatestEligibleFeature(settings.lastSeenFeatureVersion ?? current, current);
        const shown = feature && ('stepId' in feature
            ? TourGuide.startFeatureSpotlight(feature.version, feature.stepId, () => {})
            : feature.kind === 'platforms' ? TourGuide.showPlatformHighlights()
            : TourGuide.showV2UpgradeSpotlight(() => { void chrome.tabs.create({ url: FEEDBACK_URL }); }));
        if (shown) {
            void updateSettings({ lastSeenFeatureVersion: feature.version }).catch(error => statusError(error));
        }
    }
}

if (typeof document !== 'undefined') {
    const start = () => {
        void initWorkbench().catch(error => {
            const status = document.getElementById('status');
            if (status) status.textContent = errorText(error);
        });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}
