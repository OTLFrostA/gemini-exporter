import { elementById as el, requiredElement as control } from '../shared/elements.js';
import { observeDomainChanges } from '../../runtime/api/domainChanges.js';
import { exportSummary } from '../shared/exportSummary.js';
import { ensureV2Ready } from '../../runtime/api/runtimeReady.js';
import { updateSettings, isLiveSaveEffective, type GlobalSettings } from '../../application/settings/index.js';
import * as Cleanup from '../../application/localCleanup.js';
import { warmLocalFontCache } from '../../l4/format/pdf/typst/fonts/localFontProvider.js';
import { ConversationViewState } from './state/conversationsStore.js';
import { runExport, type UIExportRequest } from './controllers/exportController.js';
import { startSync } from './controllers/syncController.js';
import type { ScanResult } from '../../application/sync/scanController.js';
import { handleTakeoutImport } from './controllers/takeoutController.js';
import * as Directory from '../../runtime/capabilities/dirHandleController.js';
import { resolveScanTarget } from '../../runtime/capabilities/tabService.js';
import { renderList } from './views/listView.js';
import { EXPORT_FORMATS, readSettings, observeSettings, useSettings, labelPage, labelThemeToggle, text, errorText } from '../shared/settings.js';
import { TourGuide, consumeTourIntent } from '../guidance/tourGuide.js';
import { getLatestEligibleFeature } from '../guidance/featureReleases.js';
import { DIRECT_WRITE_THRESHOLD, FEEDBACK_URL } from '../../shared/utils/constants.js';
import { showDirectWritePrompt } from './views/directWritePrompt.js';
import { confirmCleanup } from './views/cleanupPrompt.js';
import type { ExportDiagnostic, ExportItemUpdate, ExportResult } from '../../application/export/types.js';
import { isAccountId } from '../../l2/accountRegistry.js';

type Level = 'info' | 'warn' | 'error';
type Action = 'scan' | 'export' | 'takeout' | 'cleanup' | null;
interface LogEntry { at: number; level: Level; message: string }
type UiMessage = string | (() => string);
const resolveUiMessage = (message: UiMessage): string => typeof message === 'function' ? message() : message;
interface ExportRunDiagnostic {
    startedAt: number;
    finishedAt?: number;
    request: UIExportRequest;
    items: (ExportItemUpdate & { at: number; title?: string })[];
    diagnostics: (ExportDiagnostic & { at: number; title?: string })[];
    droppedDiagnostics: number;
    result?: ExportResult;
    error?: string;
}

export async function initWorkbench(): Promise<void> {
    const installationTour = consumeTourIntent();
    const state = new ConversationViewState();
    let settings: GlobalSettings;
    let directoryAvailable = false;
    let busy = false;
    let themeSaving = false;
    let presentationSaving = false;
    let action: Action = null;
    let controller: AbortController | null = null;
    let lastRequest: UIExportRequest | null = null;
    let failed: UIExportRequest['keys'] = [];
    let dismissedFailures = false;
    let folderSuggestionPending = false;
    let connectionError: string | null = null;
    // Browser batches are only staged until their final download is initiated.
    const preparedExportKeys = new Set<string>();
    const log: LogEntry[] = [];
    let currentStatus: UiMessage | null = null;
    let currentProgress: UiMessage | null = null;
    const exportRuns: ExportRunDiagnostic[] = [];
    let droppedExportRuns = 0;
    const scanRuns: { startedAt: number; finishedAt: number; accountId: string | null; forceFull: boolean; result: ScanResult }[] = [];

    const renderLog = () => {
        const level = control('select', 'logLevel').value;
        const query = control('input', 'logFilter').value.trim().toLowerCase();
        const rows = log.filter(entry => {
            if (level === 'error' && entry.level !== 'error') return false;
            if (level === 'warn' && entry.level === 'info') return false;
            const matched = (entry.message + ' ' + entry.level).toLowerCase();
            return query.startsWith('-') ? !matched.includes(query.slice(1)) : matched.includes(query);
        });
        el('log').textContent = rows.map(entry => `[${new Date(entry.at).toLocaleTimeString()}] [${entry.level}] ${entry.message}`).join('\n') || text('Ready', '就绪');
        el('log').scrollTop = el('log').scrollHeight;
    };
    const status = (message: UiMessage, level: Level = 'info', rawLogMessage?: string) => {
        connectionError = null;
        currentStatus = message;
        currentProgress = null;
        const displayed = resolveUiMessage(message);
        // Only one of the progress label and final/status line is visible at a time.
        el('progText').textContent = '';
        el('progText').style.display = 'none';
        el('scanSlowHint').style.display = 'none';
        el('status').textContent = displayed;
        el('status').style.display = 'block';
        // Log entries keep their event-time message; language changes only re-render the status.
        log.push({ at: Date.now(), level, message: rawLogMessage ?? displayed });
        if (log.length > 400) log.shift();
        renderLog();
    };
    const statusError = (error: unknown, level: Level = 'error') =>
        status(() => errorText(error), level, error instanceof Error ? error.message : String(error));
    const progress = (message: UiMessage, percent?: number) => {
        if (!busy || controller?.signal.aborted) return;
        currentProgress = message;
        const displayed = resolveUiMessage(message);
        el('progText').textContent = displayed;
        el('progText').style.display = 'block';
        // Preserve the existing status contract for callers/tests, but do not show it twice.
        el('status').textContent = displayed;
        el('status').style.display = 'none';
        // Scan has no known total; Export counts settled items and Takeout reports a percentage.
        if ((action === 'export' || action === 'takeout') && percent !== undefined && Number.isFinite(percent)) {
            el('bar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
    };
    const showFailures = () => {
        const card = el('exportFailureCard');
        card.style.display = failed.length && !dismissedFailures ? 'block' : 'none';
        const container = el('exportFailureList');
        container.replaceChildren();
        for (const key of failed) {
            const line = document.createElement('div');
            line.textContent = `${key.conversationId}: ${text('Export failed', '导出失败')}`;
            container.append(line);
        }
    };
    const renderConversations = () => renderList(state, busy,
        action === 'export' ? preparedExportKeys : undefined,
        new Set(failed.filter(key => key.accountId === state.accountId).map(key => key.conversationId)));
    const render = () => {
        labelPage();
        el('btnPlatformPermissions').textContent = text('Site access', '网站授权');
        const moreButton = control('button', 'btnMoreActions');
        moreButton.setAttribute('aria-label', text('More actions', '更多操作'));
        moreButton.title = text('More actions', '更多操作');
        moreButton.disabled = busy || !settings;
        if (moreButton.disabled) {
            el('moreActionsMenu').hidden = true;
            moreButton.setAttribute('aria-expanded', 'false');
        }
        if (currentStatus !== null) el('status').textContent = resolveUiMessage(currentStatus);
        if (currentProgress !== null) {
            const displayed = resolveUiMessage(currentProgress);
            el('progText').textContent = displayed;
            el('status').textContent = displayed;
        }
        el('scanSlowHint').textContent = text(
            'As conversation history grows, Gemini scans may take significantly longer.',
            '随着对话历史增加，Gemini 的扫描时间可能会显著变长。');
        labelThemeToggle(control('button', 'btnThemeToggle'), settings);
        control('button', 'btnThemeToggle').disabled = !settings || themeSaving;
        document.body.dataset.busy = String(busy);
        document.body.classList.toggle('dev-mode', settings?.developerMode ?? false);
        const controls = [
            ['select', ['accountIdSelect', 'format', 'chatFilterSelect']],
            ['input', ['skipExported', 'includeAssets', 'liveSaveDiskToggle', 'chatSearchInput', 'btnSelectAll']],
            ['button', ['btnSetDir', 'btnExport', 'btnRetryFailed', 'btnClearExported', 'btnClearScan',
                'btnSyncAll', 'btnForceFullScan', 'btnImportTakeout', 'btnTourGuide', 'btnPlatformPermissions']],
        ] as const;
        for (const [tag, ids] of controls) for (const id of ids) control(tag, id).disabled = busy || !settings;
        for (const id of ['devToggle', 'langToggle'])
            control('input', id).disabled = !settings || presentationSaving;
        el('delivery').setAttribute('aria-label', text('Export to', '导出到'));
        el('exportOptionsLock').hidden = !(busy && action === 'export');
        el('exportOptionsLock').textContent = text('Exporting — options are locked', '导出中，选项已锁定');
        const folderSelected = settings?.exportDelivery === 'folderWriter';
        for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="delivery"]')) {
            radio.checked = radio.value === (settings?.exportDelivery ?? 'browserDownload');
            radio.disabled = busy || !settings;
        }
        el('localFolderControls').classList.toggle('is-disabled', !folderSelected);
        const selector = control('select', 'accountIdSelect');
        selector.setAttribute('aria-label', text('Account', '账户'));
        el('chatSearchInput').setAttribute('aria-label', text('Search title or ID', '搜索标题或 ID'));
        selector.replaceChildren();
        for (const account of state.accounts) {
            const option = document.createElement('option');
            option.value = account.id;
            const provider = account.providerId === 'chatgpt' ? 'ChatGPT' : account.providerId === 'grok' ? 'Grok'
                : account.providerId === 'claude' ? 'Claude' : 'Gemini';
            option.textContent = `${provider} · ${account.displayName || account.email || account.providerAccountId}`;
            selector.append(option);
        }
        selector.value = state.accountId ?? '';
        selector.style.display = state.accounts.length ? 'inline-flex' : 'none';
        const account = state.accounts.find(a => a.id === state.accountId);
        const name = account?.displayName || account?.email || account?.providerAccountId || text('No local account', '暂无本地账户');
        el('accountName').textContent = state.accounts.length ? '' : text('Connect a platform', '请先连接平台');
        el('accountName').style.display = state.accounts.length ? 'none' : 'inline-flex';
        el('takeoutAccountName').textContent = state.accountId
            ? account?.providerId === 'gemini' ? `→ ${name}` : text('Select Gemini', '请选择 Gemini')
            : text('First import', '首次导入');
        el('takeoutAccountName').title = state.accountId ? name : text('Creates a default Gemini account after choosing a ZIP', '选定 ZIP 后创建 Gemini 默认账户');
        selector.title = name;
        el('ver').textContent = chrome.runtime.getManifest().version;
        if (settings) {
            control('select', 'format').value = settings.defaultFormat;
            control('input', 'skipExported').checked = settings.skipExported;
            control('input', 'includeAssets').checked = settings.includeAssets;
            control('input', 'devToggle').checked = settings.developerMode;
            const en = !document.documentElement.lang.startsWith('zh');
            control('input', 'langToggle').checked = en;
            el('labelLangEn').style.color = en ? 'var(--text)' : 'var(--muted)';
            el('labelLangZh').style.color = en ? 'var(--muted)' : 'var(--text)';
            // Changing the export destination or format pauses Live Save without forgetting intent.
            control('input', 'liveSaveDiskToggle').checked = settings.enabledDisk;
            control('input', 'liveSaveDiskToggle').disabled =
                busy || !folderSelected || settings.defaultFormat !== 'markdown' || !directoryAvailable;
            const liveStatus = el('liveSaveStatus');
            liveStatus.hidden = !settings.enabledDisk;
            liveStatus.textContent = isLiveSaveEffective(settings, directoryAvailable)
                ? text('Live Save active', '实时保存已开启')
                : !folderSelected
                    ? text('Paused: select local folder to resume', '已暂停 · 选择本地文件夹后恢复')
                    : settings.defaultFormat !== 'markdown'
                        ? text('Paused: Markdown only; switch back to resume', '已暂停 · 仅支持 Markdown，切回后恢复')
                        : text('Paused: authorize a folder to resume', '已暂停 · 请选择或重新授权文件夹');
        }
        // The folder picker and Live Save share a handle and depend on folder delivery.
        control('button', 'btnSetDir').disabled = busy || !folderSelected;
        const handle = Directory.getDirHandle();
        const pending = Directory.getPendingPermissionHandle();
        const folderName = handle?.name || pending?.name;
        el('dirLabel').textContent = folderName || text('No folder selected', '未选择文件夹');
        el('dirLabel').title = folderName || text('No folder selected', '尚未选择文件夹');
        el('dirPermissionLabel').textContent = handle && directoryAvailable
            ? text('Authorized', '已授权')
            : pending ? text('Permission needs renewal', '需要重新授权')
                : text('Not authorized', '尚未授权');
        control('button', 'btnSetDir').textContent = pending
            ? text('Reauthorize', '重新授权')
            : handle ? text('Change', '更换') : text('Choose folder', '选择文件夹');
        control('button', 'btnImportTakeout').disabled = busy || !settings ||
            !!(state.accountId && account?.providerId !== 'gemini');
        for (const id of ['btnClearExported', 'btnClearScan']) control('button', id).disabled = busy || !state.accountId;
        control('button', 'btnForceFullScan').disabled = busy || !settings?.developerMode;
        el('btnCancel').style.display = action === 'export' && !!controller ? 'inline-flex' : 'none';
        el('btnStopScan').style.display = action === 'scan' && !!controller ? 'inline-flex' : 'none';
        el('progWrap').style.display = busy && (action === 'scan' || action === 'export' || action === 'takeout') ? 'block' : 'none';
        el('progWrap').classList.toggle('indeterminate', action === 'scan');
        renderConversations();
        control('button', 'btnExport').disabled ||= !settings || folderSuggestionPending;
        showFailures();
    };
    const refresh = async () => {
        await state.refresh(); render();
        const previousError = connectionError;
        const accountId = state.accountId;
        if (!previousError || busy || !accountId) return;
        try {
            const connected = await resolveScanTarget(accountId);
            // An intervening operation/account switch must keep its own status.
            if (connected === accountId && state.accountId === accountId && !busy && connectionError === previousError)
                status(() => text('Account connected. Sync conversations to refresh history.', '账号已连接，可同步会话更新历史。'));
        } catch { /* Keep actionable guidance until a verified Content source is available. */ }
    };
    const select = async (id: string) => {
        if (id !== state.accountId) { lastRequest = null; failed = []; dismissedFailures = false; }
        state.selectAccount(id); render(); await refresh();
    };
    const perform = async (kind: Action, task: (signal: AbortSignal) => Promise<void>, cancellable = false) => {
        if (busy) return;
        busy = true; action = kind;
        const taskController = new AbortController();
        controller = cancellable ? taskController : null;
        // Never show the previous operation's percent or label at the start of a new run.
        currentStatus = null; currentProgress = null;
        el('bar').style.width = '0%';
        el('progText').textContent = '';
        el('progText').style.display = 'none';
        el('scanSlowHint').style.display = 'none';
        el('status').textContent = '';
        el('status').style.display = 'block';
        render();
        try { await task(taskController.signal); }
        catch (error) {
            statusError(error);
            if (kind === 'scan' && error instanceof Error &&
                (error.message === 'Open Gemini, ChatGPT, Claude or Grok and connect an account before scanning.'
                    || error.message === 'Open Gemini, log in and refresh the page before scanning.'))
                connectionError = error.message;
        }
        finally {
            try { await refresh(); } catch (error) { statusError(error); }
            busy = false; action = null; controller = null; render();
        }
    };
    const exportRequest = (request: UIExportRequest, fonts: Promise<void>) => perform('export', async (signal) => {
        lastRequest = { ...request, keys: request.keys.map(key => ({ ...key })) };
        const run: ExportRunDiagnostic = { startedAt: Date.now(), request: lastRequest,
            items: [], diagnostics: [], droppedDiagnostics: 0 };
        exportRuns.push(run);
        if (exportRuns.length > 10) { exportRuns.shift(); droppedExportRuns++; }
        const titleFor = (key: UIExportRequest['keys'][number] | undefined) => key
            && state.indexes.find(index => index.key.accountId === key.accountId
                && index.key.conversationId === key.conversationId)?.title;
        failed = []; dismissedFailures = false; preparedExportKeys.clear(); render();
        status(() => text('Preparing export…', '正在准备导出…'));
        try {
            await fonts;
            if (request.delivery === 'folderWriter' && !await Directory.verifyDirPermission(Directory.getDirHandle()))
                throw new Error('Authorize a folder first');
            const processed = new Set<string>();
            let saved = 0;
            const result = await runExport(request, { signal,
                onDiagnostic: diagnostic => {
                    if (run.diagnostics.length >= 10000) { run.droppedDiagnostics++; return; }
                    run.diagnostics.push({ ...diagnostic, at: Date.now(), title: titleFor(diagnostic.key) });
                },
                onProgress: p => progress(() => text(`Processing ${p.current}/${p.total}`, `正在处理 ${p.current}/${p.total}`)),
                onItemUpdate: update => {
                    run.items.push({ ...update, at: Date.now(), title: titleFor(update.key) });
                    processed.add(`${update.key.accountId}/${update.key.conversationId}`);
                    if (update.status === 'failed' && !failed.some(key =>
                        key.accountId === update.key.accountId && key.conversationId === update.key.conversationId))
                        failed = [...failed, update.key];
                    if (update.status === 'exported') {
                        saved++;
                        failed = failed.filter(key => key.accountId !== update.key.accountId || key.conversationId !== update.key.conversationId);
                    }
                    if (update.key.accountId === state.accountId) {
                        if (update.status === 'prepared') preparedExportKeys.add(update.key.conversationId);
                        else preparedExportKeys.delete(update.key.conversationId);
                        if (update.status === 'exported') state.records[update.key.conversationId] = update.record;
                    }
                    const total = request.keys.length;
                    // Reserve the last 10% for Browser batch delivery; staging is not a receipt.
                    const percent = total ? Math.round(processed.size / total *
                        (request.delivery === 'browserDownload' ? 90 : 100)) : 100;
                    progress(() => request.delivery === 'browserDownload'
                        ? text(`Processed ${processed.size}/${total} · prepared ${preparedExportKeys.size} for download`,
                            `已处理 ${processed.size}/${total} · 已准备 ${preparedExportKeys.size} 条待下载`)
                        : text(`Processed ${processed.size}/${total} · saved ${saved}`,
                            `已处理 ${processed.size}/${total} · 已保存 ${saved}`), percent);
                    // Skipping changes progress only; the row's stored outcome and selection are unchanged.
                    if (update.status !== 'skipped') renderConversations();
                }
            });
            run.result = result;
            preparedExportKeys.clear();
            el('bar').style.width = '100%';
            failed = [...result.failed];
            status(() => exportSummary(result), failed.length || result.aborted || result.partial ? 'warn' : 'info');
        } catch (error) {
            run.error = error instanceof Error ? error.message : String(error);
            throw error;
        } finally { run.finishedAt = Date.now(); }
     }, true);
    const scan = (forceFull = false) => perform('scan', async (signal) => {
        const startedAt = Date.now();
        status(() => text('Resolving conversation source…', '正在确认会话来源…'));
        const slowHint = el('scanSlowHint');
        const result = await startSync(state.accountId ?? undefined, { signal, forceFull,
            onTarget: select, onProgress: p => {
                if (!busy || signal.aborted) return;
                progress(() => text(`Committed ${p.pagesFetched} pages, ${p.conversationsFetched} source entries`,
                    `已接纳 ${p.pagesFetched} 页、${p.conversationsFetched} 条来源记录`));
                slowHint.style.display = p.conversationsFetched > 200 && state.accounts.find(a => a.id === state.accountId)?.providerId === 'gemini' ? 'block' : 'none';
            } });
        scanRuns.push({ startedAt, finishedAt: Date.now(), accountId: state.accountId, forceFull, result });
        if (scanRuns.length > 10) scanRuns.shift();
        const reasons = new Map(Object.entries({
            up_to_date: () => text('Connected to trusted history coverage', '已衔接可信历史范围'),
            complete: () => text('Reached the end of this Recent source', '已达到本次 Recent 来源尽头'),
            provider_limit: () => text('Source online access limit', '来源在线访问范围限制'),
            max_pages: () => state.accounts.find(a => a.id === state.accountId)?.providerId === 'claude'
                ? text('Claude list coverage cannot yet be verified', 'Claude 列表完整性尚无法验证')
                : text('Local page budget reached', '已达到本地页数预算'),
            invalid_response: () => text('Scan failed: invalid Gemini response', '扫描失败：Gemini 返回无效响应'),
            aborted: () => text('Scan cancelled', '扫描已取消'), error: () => text('Scan failed', '扫描失败')
        }));
        const reason = result.diagnostics?.failure ?? result.reason ?? result.status;
        status(() => `${reasons.get(reason)?.() ?? (result.status === 'error' ? text('Scan failed', '扫描失败') : text('Scan finished', '扫描已结束'))} · ${result.pagesFetched} / ${result.conversationsFetched}`,
            result.status === 'error' ? 'error' : result.status === 'aborted' || result.status === 'partial_limit' ? 'warn' : 'info',
            // Keep upstream diagnostic details in the log without exposing untranslated UI text.
            result.status === 'error' ? `Scan failed (${result.reason ?? 'unknown'}) · ${result.pagesFetched} / ${result.conversationsFetched}` : undefined);
        settings = await readSettings();
        if (state.accounts.find(a => a.id === state.accountId)?.providerId === 'gemini'
            && result.conversationsFetched > 150 && !settings.takeoutPromptCompleted) {
            const shown = TourGuide.showTakeoutPrompt(result.conversationsFetched,
                () => {},
                () => { fileInput.click(); },
                () => { window.open('https://takeout.google.com/settings/takeout/custom/gemini', '_blank', 'noopener,noreferrer'); });
            // Once shown, it stays dismissed even if the page closes before acknowledgement.
            if (shown) {
                settings = { ...settings, takeoutPromptCompleted: true };
                void updateSettings({ takeoutPromptCompleted: true }).catch(e => statusError(e));
            }
        }
    }, true);
    const moreActionsButton = control('button', 'btnMoreActions');
    const moreActionsMenu = el('moreActionsMenu');
    const closeMoreActions = () => {
        moreActionsMenu.hidden = true;
        moreActionsButton.setAttribute('aria-expanded', 'false');
    };
    moreActionsButton.addEventListener('click', () => {
        if (busy || !settings) return;
        moreActionsMenu.hidden = !moreActionsMenu.hidden;
        moreActionsButton.setAttribute('aria-expanded', String(!moreActionsMenu.hidden));
    });
    moreActionsMenu.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.closest('button')) {
            closeMoreActions();
            moreActionsButton.focus();
        }
    });
    control('dialog', 'cleanupModal').addEventListener('close', () => {
        if (moreActionsMenu.hidden) moreActionsButton.focus();
    });
    document.addEventListener('pointerdown', event => {
        if (event.target instanceof Node && !moreActionsButton.parentElement?.contains(event.target))
            closeMoreActions();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !moreActionsMenu.hidden) {
            closeMoreActions();
            moreActionsButton.focus();
        }
    });
    el('btnSyncAll').addEventListener('click', () => { void scan(); });
    el('btnForceFullScan').addEventListener('click', () => { if (settings.developerMode) void scan(true); });
    const cancel = () => { controller?.abort(); status(() => text('Cancelling…', '正在取消…'), 'warn'); };
    el('btnCancel').addEventListener('click', cancel);
    el('btnStopScan').addEventListener('click', cancel);
    el('btnExport').addEventListener('click', () => {
        const keys = state.keys();
        if (busy || folderSuggestionPending || !keys.length || !settings) return;
        const request: UIExportRequest = { keys, format: settings.defaultFormat,
            delivery: settings.exportDelivery ?? 'browserDownload',
            includeAssets: settings.includeAssets, skipUnchanged: settings.skipExported };
        const start = (delivery: UIExportRequest['delivery']) => {
            const fonts = request.format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
            void exportRequest({ ...request, delivery }, fonts);
        };
        if (request.delivery === 'browserDownload' && keys.length > DIRECT_WRITE_THRESHOLD
            && !settings.directWritePromptCompleted && !TourGuide.isActive()) {
            const shown = showDirectWritePrompt(keys.length, () => {
                // The picker/reauthorization must start in the modal button's user gesture.
                const permission = Directory.getPendingPermissionHandle()
                    ? Directory.reauthorizeDirHandle() : Directory.requestDirHandle();
                folderSuggestionPending = true; render();
                void (async () => {
                    try {
                        if (!await permission || !await Directory.verifyDirPermission(Directory.getDirHandle()))
                            throw new Error('Folder permission denied');
                        directoryAvailable = true;
                        await updateSettings({ exportDelivery: 'folderWriter' });
                        settings = await readSettings(); render();
                        start('folderWriter');
                    } catch (error) { statusError(error, 'warn'); }
                    finally { folderSuggestionPending = false; render(); }
                })();
            }, () => start('browserDownload'));
            if (shown) {
                // Mark at first display, not on which option the user picks (or whether they close).
                settings = { ...settings, directWritePromptCompleted: true };
                void updateSettings({ directWritePromptCompleted: true })
                    .catch(error => statusError(error));
                return;
            }
        }
        start(request.delivery);
    });
    el('btnRetryFailed').addEventListener('click', () => {
        if (busy || !lastRequest || !failed.length) return;
        const fonts = lastRequest.format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
        void exportRequest({ ...lastRequest, keys: [...failed], skipUnchanged: false }, fonts);
    });
    el('btnDismissFailure').addEventListener('click', () => { dismissedFailures = true; showFailures(); });
    el('btnCopyFailedLog').addEventListener('click', () => {
        void navigator.clipboard.writeText(failed.map(key =>
            `${key.conversationId}: Export failed`).join('\n'))
            .catch(e => statusError(e));
    });
    el('btnSetDir').addEventListener('click', () => {
        if (busy || settings?.exportDelivery !== 'folderWriter') return;
        const permission = Directory.getPendingPermissionHandle() ? Directory.reauthorizeDirHandle() : Directory.requestDirHandle();
        void perform('cleanup', async () => {
            if (!await permission) throw new Error('Folder permission denied');
            directoryAvailable = await Directory.verifyDirPermission(Directory.getDirHandle());
            status(() => text('Folder authorized', '目录已授权'));
        });
    });
    el('delivery').addEventListener('change', event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.name !== 'delivery') return;
        if (busy || !settings || input.disabled) { render(); return; }
        if (!input.checked) return;
        const exportDelivery: UIExportRequest['delivery'] =
            input.value === 'folderWriter' ? 'folderWriter' : 'browserDownload';
        if (settings.exportDelivery === exportDelivery) return;
        const previous = settings;
        settings = { ...settings, exportDelivery };
        void perform('cleanup', async () => {
            try { await updateSettings({ exportDelivery }); settings = await readSettings(); }
            catch (error) { settings = previous; throw error; }
        });
    });
    const fileInput = control('input', 'takeoutFileInput');
    el('btnImportTakeout').addEventListener('click', () => { if (!busy) fileInput.click(); });
    const importFile = (file: File) => perform('takeout', async () => {
        status(() => text('Importing Takeout ZIP…', '正在导入 Takeout ZIP…'));
        try {
            const result = await handleTakeoutImport(file, state.accountId, { onTarget: select,
                onProgress: percent => progress(() => text(`Importing ${percent}%`, `正在导入 ${percent}%`), percent) });
            status(() => text(`Imported ${result.imported} conversations (${result.status})`,
                `已提交 ${result.imported} 条对话（${result.status === 'ok' ? '完成' : result.status === 'partial' ? '部分完成' : '未知'}）`));
        } finally { fileInput.value = ''; }
    });
    fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void importFile(file); });
    el('btnImportTakeout').addEventListener('dragover', event => event.preventDefault());
    el('btnImportTakeout').addEventListener('drop', event => {
        event.preventDefault();
        const file = event.dataTransfer?.files[0];
        if (file && !busy) void importFile(file);
    });
    for (const [id, scanRecords] of [['btnClearExported', false], ['btnClearScan', true]] as const)
        el(id).addEventListener('click', async () => {
            const accountId = state.accountId;
            if (!accountId || busy) return;
            const account = state.accounts.find(a => a.id === accountId);
            const name = account?.displayName || account?.email || account?.providerAccountId || accountId;
            if (!await confirmCleanup(scanRecords, name) || busy || state.accountId !== accountId) return;
            void perform('cleanup', async () => {
                if (scanRecords) await Cleanup.clearLocalScanRecords(accountId);
                else await Cleanup.clearLocalExportRecords(accountId);
                failed = []; dismissedFailures = false;
                status(() => text('Records cleared', '记录已清除'));
            });
        });
    control('select', 'accountIdSelect').addEventListener('change', () => {
        if (busy) { render(); return; }
        void select(control('select', 'accountIdSelect').value).catch(e => statusError(e));
    });
    control('input', 'chatSearchInput').addEventListener('input', () => {
        state.search = control('input', 'chatSearchInput').value; renderConversations();
    });
    control('select', 'chatFilterSelect').addEventListener('change', () => {
        state.filter = control('select', 'chatFilterSelect').value; renderConversations();
    });
    control('input', 'btnSelectAll').addEventListener('change', () => {
        if (busy) return;
        if (control('input', 'btnSelectAll').checked) state.selectVisible();
        else state.selected.clear();
        renderConversations();
    });
    const changeControlSetting = (input: HTMLInputElement | HTMLSelectElement, patch: Partial<GlobalSettings>) => {
        // A disabled Live Save switch must never mutate persisted intent.
        if (busy || input.disabled) { render(); return; }
        const prior = settings; settings = { ...settings, ...patch };
        void perform('cleanup', async () => {
            try { await updateSettings(patch); settings = await readSettings(); }
            catch (error) { settings = prior; throw error; }
        });
    };
    const formatControl = control('select', 'format');
    formatControl.addEventListener('change', () => {
        const format = EXPORT_FORMATS.find(value => value === formatControl.value);
        if (format) changeControlSetting(formatControl, { defaultFormat: format });
    });
    const checkboxSettings: readonly (readonly [HTMLInputElement, 'skipExported' | 'includeAssets' | 'enabledDisk'])[] = [
        [control('input', 'skipExported'), 'skipExported'],
        [control('input', 'includeAssets'), 'includeAssets'],
        [control('input', 'liveSaveDiskToggle'), 'enabledDisk'],
    ];
    for (const [input, field] of checkboxSettings) input.addEventListener('change', () => {
        changeControlSetting(input, { [field]: input.checked });
    });
    control('button', 'btnThemeToggle').addEventListener('click', () => {
        if (!settings || themeSaving) return;
        const previous = settings;
        const theme = settings.theme === 'light' ? 'dark' : 'light';
        themeSaving = true;
        settings = { ...settings, theme };
        useSettings(settings);
        render();
        void updateSettings({ theme }).then(async () => { settings = await readSettings(); })
            .catch(error => { settings = previous; useSettings(previous); statusError(error); })
            .finally(() => { themeSaving = false; render(); });
    });
    const savePresentation = async (patch: Pick<GlobalSettings, 'developerMode'> | Pick<GlobalSettings, 'language'>) => {
        if (!settings || presentationSaving) { render(); return; }
        const prior = settings;
        presentationSaving = true;
        settings = { ...settings, ...patch }; useSettings(settings); render();
        // Display preferences must not acquire or reset the running task's busy/controller state.
        try { await updateSettings(patch); settings = await readSettings(); }
        catch (error) { settings = prior; useSettings(prior); statusError(error); }
        finally { presentationSaving = false; render(); }
    };
    control('input', 'devToggle').addEventListener('change', () => {
        void savePresentation({ developerMode: control('input', 'devToggle').checked });
    });
    control('input', 'langToggle').addEventListener('change', () => {
        void savePresentation({ language: control('input', 'langToggle').checked ? 'en' : 'zh' });
    });
    el('logFilter').addEventListener('input', renderLog);
    el('logLevel').addEventListener('change', renderLog);
    el('btnCopyLog').addEventListener('click', () => {
        void navigator.clipboard.writeText(el('log').textContent ?? '').catch(e => statusError(e));
    });
    el('btnClearLog').addEventListener('click', () => { log.length = 0; renderLog(); });
    el('btnExportDiag').addEventListener('click', () => {
        const currentExportIssues = state.indexes.flatMap(index => {
            const record = state.records[index.key.conversationId];
            return record?.status === 'partial' ? [{ key: index.key, title: index.title, record,
                reasonAvailability: 'Stored outcome only; exact causes require a captured export run' }] : [];
        });
        const payload = JSON.stringify({ schemaVersion: 2, generatedAt: Date.now(),
            extensionVersion: chrome.runtime.getManifest().version, userAgent: navigator.userAgent,
            accountId: state.accountId, scanRuns, exportRuns, droppedExportRuns,
            currentExportIssues, logs: log }, null, 2);
        const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'gemini-exporter-ui-diagnostics.json';
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    el('btnPlatformPermissions').addEventListener('click', () => { if (!busy) TourGuide.showPlatformAuthorization(select); });
    el('btnTourGuide').addEventListener('click', () => { if (!busy) void TourGuide.startTour(select); });
    const applyOpenedAccount = async (value: unknown) => {
        if (!isAccountId(value)) return;
        // Consume once: directly opening Options later must not reuse a previous source.
        await chrome.storage.session.remove('openOptionsAccountId');
        if (busy) return;
        if (!state.accounts.some(account => account.id === value)) await refresh();
        if (!busy && state.accounts.some(account => account.id === value)) await select(value);
    };
    const onOpenedAccountChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
        if (area === 'session' && changes.openOptionsAccountId)
            void applyOpenedAccount(changes.openOptionsAccountId.newValue).catch(error => statusError(error));
    };
    const stopSettings = observeSettings(() => {
        void readSettings().then(next => { settings = next; render(); }).catch(e => statusError(e));
    });
    const onFocus = () => {
        if (busy) return;
        void (async () => {
            await refresh();
            try { directoryAvailable = await Directory.verifyDirPermission(Directory.getDirHandle()); }
            catch (error) { directoryAvailable = false; statusError(error, 'warn'); }
            render();
        })().catch(e => statusError(e));
    };
    const stopDomainChanges = observeDomainChanges(() => refresh().catch(e => statusError(e)));
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', () => {
        stopSettings(); stopDomainChanges(); chrome.storage.onChanged.removeListener(onOpenedAccountChange);
        window.removeEventListener('focus', onFocus); TourGuide.destroy();
    }, { once: true });
    renderLog(); render();
    await ensureV2Ready();
    settings = await readSettings();
    renderLog();
    await refresh();
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
    if (installationTour) await TourGuide.startTour(select);
    else {
        const current = chrome.runtime.getManifest().version;
        const feature = getLatestEligibleFeature(settings.lastSeenFeatureVersion ?? current, current);
        const shown = feature && ('stepId' in feature
            ? TourGuide.startFeatureSpotlight(feature.version, feature.stepId, () => {})
            : TourGuide.showV2UpgradeSpotlight(() => { void chrome.tabs.create({ url: FEEDBACK_URL }); }));
        if (shown) {
            // Persist on display, not dismissal; each announced feature is shown at most once.
            void updateSettings({ lastSeenFeatureVersion: feature.version })
                .catch(error => statusError(error));
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
