import { listIndexes } from '../../../application/conversations/catalogQueries.js';
import type { GlobalSettings } from '../../../application/settings/index.js';
import { hasPlatformAccess } from '../../../runtime/capabilities/platformAuthorization.js';
import { ScanConnectionError } from '../../../runtime/capabilities/scanConnection.js';
import type { Diagnostic } from '../../../shared/diagnostics/diagnostic.js';
import { OperationError } from '../../../shared/errors/operationError.js';
import { SOURCE_PLATFORMS } from '../../../shared/platformHosts.js';
import { TourGuide } from '../../guidance/tourGuide.js';
import { createBackoffNotice } from '../../shared/backoffNotice.js';
import type { ConversationSourceSummary } from '../../shared/conversationSourceSummary.js';
import { readSettings } from '../../shared/readSettings.js';
import { errorText, text } from '../../shared/settings.js';
import type { ConversationViewState } from '../state/conversationsStore.js';
import type { ScanEvidence, UiMessage } from '../state/foregroundTask.js';
import type { LogLevel, ScanRunDiagnostic } from './diagnosticLogController.js';
import { startSync } from './syncController.js';

interface WorkbenchScanState {
    readonly evidence: ScanEvidence | undefined;
    readonly takeoutCount: number | undefined;
    readonly slow: boolean;
    readonly connectionError: string | null;
}

export function createWorkbenchScanController(deps: {
    readonly state: ConversationViewState;
    readonly isBusy: () => boolean;
    readonly setSettings: (next: GlobalSettings) => void;
    readonly clearFeedback: () => void;
    readonly recordScanRun: (run: ScanRunDiagnostic) => void;
    readonly reportScan: (message: UiMessage | ConversationSourceSummary, level?: LogLevel, rawLogMessage?: string) => void;
    readonly showTakeout: (count: number) => void;
    readonly select: (id: string) => Promise<void>;
    readonly refresh: (changedAccountId?: string) => Promise<void>;
    readonly render: () => void;
    readonly paintTaskPanel: () => void;
    readonly statusError: (error: unknown, level?: LogLevel) => void;
}) {
    let scanController: AbortController | null = null;
    let evidence: ScanEvidence | undefined;
    let takeoutCount: number | undefined;
    let slow = false;
    let connectionError: string | null = null;
    let advanceTutorialScan: (() => void) | undefined;

    const scan = async (forceFull = false): Promise<void> => {
        if (deps.isBusy() || scanController) return;
        deps.clearFeedback();
        connectionError = null;
        takeoutCount = undefined;
        const taskController = new AbortController();
        scanController = taskController;
        const signal = taskController.signal;
        deps.render();
        let connectionFailure: ScanConnectionError | undefined;
        const finishTutorialScan = TourGuide.beginScan();
        let scanHasResults = false;
        advanceTutorialScan = finishTutorialScan ? () => {
            if (!scanHasResults || !deps.state.indexes.length) return;
            advanceTutorialScan = undefined;
            finishTutorialScan(true);
        } : undefined;
        try {
            const selected = deps.state.accounts.find(a => a.id === deps.state.accountId);
            const platform = SOURCE_PLATFORMS.find(p => p === selected?.providerId);
            const access = platform ? await hasPlatformAccess(platform) : true;
            signal.throwIfAborted();
            if (selected && platform && !access) {
                TourGuide.showAccountConnection(
                    platform, selected.id, selected.email || selected.displayName || platform,
                    () => { void scan(forceFull); },
                );
                return;
            }
            const startedAt = Date.now();
            evidence = undefined;
            deps.reportScan(() => text('Resolving conversation source…', '正在确认会话来源…'));
            const backoff = createBackoffNotice();
            const diagnostics: Diagnostic[] = [];
            let scanProgressMessage = () => text('Resolving conversation source…', '正在确认会话来源…');
            const paintScanProgress = () => deps.reportScan(() => scanProgressMessage() + (backoff.message() ? ` · ${backoff.message()}` : ''));
            const stopBackoffTicker = backoff.startTicker(paintScanProgress);
            let baselineIds = new Set<string>();
            const result = await startSync(deps.state.accountId ?? undefined, {
                signal,
                forceFull,
                onDiagnostic: diagnostic => {
                    if (diagnostics.length < 1000) diagnostics.push(diagnostic);
                    if (backoff.observe(diagnostic)) paintScanProgress();
                },
                onTarget: async id => {
                    baselineIds = new Set((await listIndexes(id)).map(row => row.key.conversationId));
                    await deps.select(id);
                },
                onProgress: p => {
                    if (signal.aborted) return;
                    evidence = { accountId: deps.state.accountId, progress: p };
                    scanProgressMessage = () => text(
                        `Committed ${p.pagesFetched} pages, ${p.conversationsFetched} source entries`,
                        `已接纳 ${p.pagesFetched} 页、${p.conversationsFetched} 条来源记录`,
                    );
                    paintScanProgress();
                    if (advanceTutorialScan && p.conversationsFetched > 0) {
                        scanHasResults = true;
                        void deps.refresh().catch(deps.statusError);
                    }
                    slow = p.conversationsFetched > 200 && deps.state.accounts.find(a => a.id === deps.state.accountId)?.providerId === 'gemini';
                    deps.paintTaskPanel();
                },
            }).finally(stopBackoffTicker);
            scanHasResults ||= result.conversationsFetched > 0;
            deps.recordScanRun({ startedAt, finishedAt: Date.now(), accountId: deps.state.accountId, forceFull, result, diagnostics });
            const reason = result.diagnostics?.failure ?? result.reason ?? result.status;
            const succeeded = result.status === 'complete' || result.status === 'up_to_date';
            const committedProgress = { pagesFetched: result.pagesFetched, conversationsFetched: result.conversationsFetched };
            evidence = {
                accountId: deps.state.accountId,
                progress: committedProgress,
                result: { ...committedProgress, status: result.status, reason: result.reason, diagnostics: result.diagnostics },
            };
            await deps.refresh();
            const added = result.indexChanges?.added ?? deps.state.indexes.filter(row => !baselineIds.has(row.key.conversationId)).length;
            if (reason === 'provider_limit' && deps.state.accounts.find(a => a.id === deps.state.accountId)?.providerId === 'gemini') {
                takeoutCount = result.conversationsFetched;
            }
            deps.reportScan(
                {
                    method: 'sync',
                    status: succeeded ? 'complete' : result.status === 'partial_limit' ? 'partial'
                        : result.status === 'aborted' ? 'aborted' : 'error',
                    read: result.conversationsFetched,
                    added,
                    updated: result.indexChanges?.updated,
                },
                result.status === 'error' ? 'error' : result.status === 'aborted' || result.status === 'partial_limit' ? 'warn' : 'info',
                result.status === 'error' ? `Sync ${result.status} (${reason}) · ${result.pagesFetched} pages · ${result.conversationsFetched} source entries` : undefined,
            );
            const refreshedSettings = await readSettings();
            deps.setSettings(refreshedSettings);
            if (deps.state.accounts.find(a => a.id === deps.state.accountId)?.providerId === 'gemini'
                && result.conversationsFetched > 150 && !refreshedSettings.takeoutPromptCompleted) {
                deps.showTakeout(result.conversationsFetched);
            }
        } catch (error) {
            if (signal.aborted) deps.reportScan(() => text('Sync stopped', '同步已停止'));
            else {
                deps.reportScan(() => errorText(error), 'error', error instanceof Error ? error.message : String(error));
                if (error instanceof ScanConnectionError) {
                    connectionFailure = error;
                    if (error.platform === 'gemini') connectionError = error.message;
                } else if (error instanceof OperationError && error.code === 'NO_CONNECTED_ACCOUNT') {
                    connectionError = error.message;
                }
            }
        } finally {
            try { await deps.refresh(); } catch (error) { deps.reportScan(() => errorText(error), 'error'); }
            scanController = null;
            slow = false;
            deps.render();
            advanceTutorialScan?.();
            finishTutorialScan?.(false);
        }
        const account = deps.state.accounts.find(a => a.id === deps.state.accountId);
        if (connectionFailure && account) {
            TourGuide.showAccountConnection(
                connectionFailure.platform, account.id, account.email || account.displayName || connectionFailure.platform,
                () => { void scan(forceFull); },
            );
        }
    };

    const stopScan = (): void => {
        if (!scanController) return;
        scanController.abort();
        deps.reportScan(() => text('Stopping sync…', '正在停止同步…'), 'warn');
        deps.render();
    };

    return {
        scan,
        stopScan,
        isScanning: () => scanController !== null,
        isScanAborted: () => scanController?.signal.aborted ?? false,
        getState: (): WorkbenchScanState => ({ evidence, takeoutCount, slow, connectionError }),
        clearConnectionError: () => { connectionError = null; },
        clearImportBannerState: () => {
            takeoutCount = undefined;
            if (!scanController) evidence = undefined;
        },
        resetAccountState: () => {
            evidence = undefined;
            takeoutCount = undefined;
            connectionError = null;
        },
        runAdvanceTutorialScan: () => { advanceTutorialScan?.(); },
    };
}
