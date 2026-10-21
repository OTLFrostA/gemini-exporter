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
import { renderList } from './views/listView.js';
import { readSettings, observeSettings, useSettings, labelPage, labelThemeToggle, text, errorText } from '../shared/settings.js';
import { TourGuide, consumeTourIntent } from '../guidance/tourGuide.js';
import { getLatestEligibleFeature } from '../guidance/featureReleases.js';

type Level = 'info' | 'warn' | 'error';
type Action = 'scan' | 'export' | 'takeout' | 'cleanup' | null;
interface LogEntry { at: number; level: Level; message: string }

/** Main's complete workbench presentation, backed by the v2 Application/Runtime ports. */
export async function initWorkbench(): Promise<void> {
    const installationTour = consumeTourIntent();
    const state = new ConversationViewState();
    let settings: GlobalSettings;
    let directoryAvailable = false;
    let busy = false;
    let themeSaving = false;
    let action: Action = null;
    let controller: AbortController | null = null;
    let lastRequest: UIExportRequest | null = null;
    let failed: UIExportRequest['keys'] = [];
    let dismissedFailures = false;
    // Browser batches are only staged until their final download is initiated.
    const preparedExportKeys = new Set<string>();
    const log: LogEntry[] = [];
    const scanRuns: { startedAt: number; finishedAt: number; accountId: string | null; forceFull: boolean; result: ScanResult }[] = [];
    const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

    const renderLog = () => {
        const level = el<HTMLSelectElement>('logLevel').value;
        const query = el<HTMLInputElement>('logFilter').value.trim().toLowerCase();
        const rows = log.filter(entry => {
            if (level === 'error' && entry.level !== 'error') return false;
            if (level === 'warn' && entry.level === 'info') return false;
            const matched = (entry.message + ' ' + entry.level).toLowerCase();
            return query.startsWith('-') ? !matched.includes(query.slice(1)) : matched.includes(query);
        });
        el('log').textContent = rows.map(entry => `[${new Date(entry.at).toLocaleTimeString()}] [${entry.level}] ${entry.message}`).join('\n') || text('Ready', '就绪');
        el('log').scrollTop = el('log').scrollHeight;
    };
    const status = (message: string, level: Level = 'info') => {
        // Only one of the progress label and final/status line is visible at a time.
        el('progText').textContent = '';
        el<HTMLElement>('progText').style.display = 'none';
        el<HTMLElement>('scanSlowHint').style.display = 'none';
        el('status').textContent = message;
        el<HTMLElement>('status').style.display = 'block';
        log.push({ at: Date.now(), level, message });
        if (log.length > 400) log.shift();
        renderLog();
    };
    const progress = (message: string, percent?: number) => {
        if (!busy || controller?.signal.aborted) return;
        el('progText').textContent = message;
        el<HTMLElement>('progText').style.display = 'block';
        // Preserve the existing status contract for callers/tests, but do not show it twice.
        el('status').textContent = message;
        el<HTMLElement>('status').style.display = 'none';
        // Scan has no known total; Export counts settled items and Takeout reports a percentage.
        if ((action === 'export' || action === 'takeout') && percent !== undefined && Number.isFinite(percent)) {
            el<HTMLElement>('bar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
    };
    const showFailures = () => {
        const card = el<HTMLElement>('exportFailureCard');
        card.style.display = failed.length && !dismissedFailures ? 'block' : 'none';
        const container = el('exportFailureList');
        container.replaceChildren();
        for (const key of failed) {
            const line = document.createElement('div');
            line.textContent = `${key.conversationId}: ${text('Export failed', '导出失败')}`;
            container.append(line);
        }
    };
    const render = () => {
        labelPage();
        labelThemeToggle(el<HTMLButtonElement>('btnThemeToggle'), settings);
        el<HTMLButtonElement>('btnThemeToggle').disabled = !settings || themeSaving;
        document.body.dataset.busy = String(busy);
        document.body.classList.toggle('dev-mode', settings?.developerMode ?? false);
        const ids = ['accountIdSelect','format','skipExported','includeAssets','liveSaveDiskToggle',
            'btnSetDir','btnExport','btnRetryFailed','btnClearExported','btnClearScan','devToggle',
            'langToggle','chatSearchInput','chatFilterSelect','btnSelectAll','btnSelectNone',
            'btnSyncAll','btnForceFullScan','btnImportTakeout','btnTourGuide'];
        for (const id of ids) el<HTMLInputElement>(id).disabled = busy || !settings;
        el('delivery').setAttribute('aria-label', text('Export to', '导出到'));
        el('exportOptionsLock').hidden = !(busy && action === 'export');
        el('exportOptionsLock').textContent = text('Exporting — options are locked', '导出中，选项已锁定');
        const folderSelected = settings?.exportDelivery === 'folderWriter';
        for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="delivery"]')) {
            radio.checked = radio.value === (settings?.exportDelivery ?? 'browserDownload');
            radio.disabled = busy || !settings;
        }
        el('localFolderControls').classList.toggle('is-disabled', !folderSelected);
        const selector = el<HTMLSelectElement>('accountIdSelect');
        selector.setAttribute('aria-label', text('Account', '账户'));
        el('chatSearchInput').setAttribute('aria-label', text('Search title or ID', '搜索标题或 ID'));
        selector.replaceChildren();
        for (const account of state.accounts) {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.displayName || account.email || `${account.providerId} · ${account.providerAccountId}`;
            selector.append(option);
        }
        selector.value = state.accountId ?? '';
        selector.style.display = state.accounts.length < 2 ? 'none' : 'inline-flex';
        const account = state.accounts.find(a => a.id === state.accountId);
        const name = account?.displayName || account?.email || account?.providerAccountId || text('No local account', '暂无本地账户');
        el('accountName').textContent = state.accounts.length < 2 ? name : '';
        el('takeoutAccountName').textContent = state.accountId
            ? account?.providerId === 'gemini' ? `→ ${name}` : text('Select Gemini', '请选择 Gemini')
            : text('First import', '首次导入');
        el('takeoutAccountName').title = state.accountId ? name : text('Creates a default Gemini account after choosing a ZIP', '选定 ZIP 后创建 Gemini 默认账户');
        selector.title = name;
        el('ver').textContent = chrome.runtime.getManifest().version;
        el('syncCount').textContent = text(`${state.indexes.length} indexed`, `已收录 ${state.indexes.length} 条`);
        if (settings) {
            el<HTMLSelectElement>('format').value = settings.defaultFormat;
            el<HTMLInputElement>('skipExported').checked = settings.skipExported;
            el<HTMLInputElement>('includeAssets').checked = settings.includeAssets;
            el<HTMLInputElement>('devToggle').checked = settings.developerMode;
            const en = !document.documentElement.lang.startsWith('zh');
            el<HTMLInputElement>('langToggle').checked = en;
            el<HTMLElement>('labelLangEn').style.color = en ? 'var(--text)' : 'var(--muted)';
            el<HTMLElement>('labelLangZh').style.color = en ? 'var(--muted)' : 'var(--text)';
            // Changing the export destination or format pauses Live Save without forgetting intent.
            el<HTMLInputElement>('liveSaveDiskToggle').checked = settings.enabledDisk;
            el<HTMLInputElement>('liveSaveDiskToggle').disabled =
                busy || !folderSelected || settings.defaultFormat !== 'markdown' || !directoryAvailable;
            const liveStatus = el<HTMLElement>('liveSaveStatus');
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
        el<HTMLButtonElement>('btnSetDir').disabled = busy || !folderSelected;
        const handle = Directory.getDirHandle();
        const pending = Directory.getPendingPermissionHandle();
        const folderName = handle?.name || pending?.name;
        el('dirLabel').textContent = folderName || text('No folder selected', '未选择文件夹');
        el('dirLabel').title = folderName || text('No folder selected', '尚未选择文件夹');
        el('dirPermissionLabel').textContent = handle && directoryAvailable
            ? text('Authorized', '已授权')
            : pending ? text('Permission needs renewal', '需要重新授权')
                : text('Not authorized', '尚未授权');
        el<HTMLButtonElement>('btnSetDir').textContent = pending
            ? text('Reauthorize', '重新授权')
            : handle ? text('Change', '更换') : text('Choose folder', '选择文件夹');
        el<HTMLButtonElement>('btnImportTakeout').disabled = busy || !settings ||
            !!(state.accountId && account?.providerId !== 'gemini');
        for (const id of ['btnClearExported', 'btnClearScan']) el<HTMLButtonElement>(id).disabled = busy || !state.accountId;
        el<HTMLButtonElement>('btnForceFullScan').disabled = busy || !settings?.developerMode;
        el<HTMLElement>('btnCancel').style.display = action === 'export' && !!controller ? 'inline-flex' : 'none';
        el<HTMLElement>('btnStopScan').style.display = action === 'scan' && !!controller ? 'inline-flex' : 'none';
        el<HTMLElement>('progWrap').style.display = busy && (action === 'scan' || action === 'export' || action === 'takeout') ? 'block' : 'none';
        el<HTMLElement>('progWrap').classList.toggle('indeterminate', action === 'scan');
        renderList(state, busy, action === 'export' ? preparedExportKeys : undefined);
        el<HTMLButtonElement>('btnExport').disabled ||= !settings;
        showFailures();
    };
    const refresh = async () => { await state.refresh(); render(); };
    const select = async (id: string) => {
        if (id !== state.accountId) { lastRequest = null; failed = []; dismissedFailures = false; }
        state.selectAccount(id); render(); await refresh();
    };
    const perform = async (kind: Action, task: () => Promise<void>, cancellable = false) => {
        if (busy) return;
        busy = true; action = kind; controller = cancellable ? new AbortController() : null;
        // Never show the previous operation's percent or label at the start of a new run.
        el<HTMLElement>('bar').style.width = '0%';
        el('progText').textContent = '';
        el<HTMLElement>('progText').style.display = 'none';
        el<HTMLElement>('scanSlowHint').style.display = 'none';
        el('status').textContent = '';
        el<HTMLElement>('status').style.display = 'block';
        render();
        try { await task(); }
        catch (error) { status(errorText(error), 'error'); }
        finally {
            try { await refresh(); } catch (error) { status(errorText(error), 'error'); }
            busy = false; action = null; controller = null; render();
        }
    };
    const exportRequest = (request: UIExportRequest, fonts: Promise<void>) => perform('export', async () => {
        lastRequest = { ...request, keys: request.keys.map(key => ({ ...key })) };
        failed = []; dismissedFailures = false; preparedExportKeys.clear(); render();
        status(text('Preparing export…', '正在准备导出…'));
        await fonts;
        if (request.delivery === 'folderWriter' && !await Directory.verifyDirPermission(Directory.getDirHandle()))
            throw new Error(text('Authorize a folder first', '请先授权文件夹'));
        const processed = new Set<string>();
        let saved = 0;
        const result = await runExport(request, { signal: controller!.signal,
            onProgress: p => progress(text(`Processing ${p.current}/${p.total}`, `正在处理 ${p.current}/${p.total}`)),
            onItemUpdate: update => {
                processed.add(`${update.key.accountId}/${update.key.conversationId}`);
                if (update.status === 'exported') saved++;
                if (update.key.accountId === state.accountId) {
                    if (update.status === 'prepared') preparedExportKeys.add(update.key.conversationId);
                    else preparedExportKeys.delete(update.key.conversationId);
                    if (update.status === 'exported') state.records[update.key.conversationId] = update.record;
                }
                const total = request.keys.length;
                // Reserve the last 10% for Browser batch delivery; staging is not a receipt.
                const percent = total ? Math.round(processed.size / total *
                    (request.delivery === 'browserDownload' ? 90 : 100)) : 100;
                progress(request.delivery === 'browserDownload'
                    ? text(`Processed ${processed.size}/${total} · prepared ${preparedExportKeys.size} for download`,
                        `已处理 ${processed.size}/${total} · 已准备 ${preparedExportKeys.size} 条待下载`)
                    : text(`Processed ${processed.size}/${total} · saved ${saved}`,
                        `已处理 ${processed.size}/${total} · 已保存 ${saved}`), percent);
                renderList(state, busy, preparedExportKeys);
            }
        });
        preparedExportKeys.clear();
        el<HTMLElement>('bar').style.width = '100%';
        failed = [...result.failed];
        status(exportSummary(result), failed.length || result.aborted || result.partial ? 'warn' : 'info');
     }, true);
    const scan = (forceFull = false) => perform('scan', async () => {
        const startedAt = Date.now();
        const signal = controller!.signal;
        status(text('Resolving Gemini source…', '正在确认 Gemini 来源…'));
        const slowHint = el<HTMLElement>('scanSlowHint');
        slowHint.textContent = text(
            'As conversation history grows, Gemini scans may take significantly longer.',
            '随着对话历史增加，Gemini 的扫描时间可能会显著变长。');
        const result = await startSync(state.accountId ?? undefined, { signal, forceFull,
            onTarget: select, onProgress: p => {
                if (!busy || signal.aborted) return;
                progress(text(`Committed ${p.pagesFetched} pages, ${p.conversationsFetched} source entries`,
                    `已接纳 ${p.pagesFetched} 页、${p.conversationsFetched} 条来源记录`));
                slowHint.style.display = p.conversationsFetched > 200 ? 'block' : 'none';
            } });
        scanRuns.push({ startedAt, finishedAt: Date.now(), accountId: state.accountId, forceFull, result });
        if (scanRuns.length > 10) scanRuns.shift();
        const reasons: Record<string, string> = {
            up_to_date: text('Connected to trusted history coverage', '已衔接可信历史范围'),
            complete: text('Reached the end of this Recent source', '已达到本次 Recent 来源尽头'),
            provider_limit: text('Source online access limit', '来源在线访问范围限制'),
            max_pages: text('Local page budget reached', '已达到本地页数预算'),
            aborted: text('Scan cancelled', '扫描已取消'), error: text('Scan failed', '扫描失败')
        };
        status(`${reasons[result.reason ?? result.status] ?? result.reason ?? result.status} · ${result.pagesFetched} / ${result.conversationsFetched}`,
            result.status === 'error' ? 'error' : result.status === 'aborted' || result.status === 'partial_limit' ? 'warn' : 'info');
        settings = await readSettings();
        if (result.conversationsFetched > 150 && !settings.takeoutPromptCompleted) {
            TourGuide.showTakeoutPrompt(result.conversationsFetched,
                () => { void updateSettings({ takeoutPromptCompleted: true }).catch(e => status(errorText(e), 'error')); },
                () => { fileInput.click(); },
                () => { window.open('https://takeout.google.com/settings/takeout/custom/gemini', '_blank', 'noopener,noreferrer'); });
        }
    }, true);
    el('btnSyncAll').addEventListener('click', () => { void scan(); });
    el('btnForceFullScan').addEventListener('click', () => { if (settings.developerMode) void scan(true); });
    const cancel = () => { controller?.abort(); status(text('Cancelling…', '正在取消…'), 'warn'); };
    el('btnCancel').addEventListener('click', cancel);
    el('btnStopScan').addEventListener('click', cancel);
    el('btnExport').addEventListener('click', () => {
        if (busy || !state.keys().length || !settings) return;
        const format = settings.defaultFormat;
        const fonts = format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
        void exportRequest({ keys: state.keys(), format,
            delivery: settings.exportDelivery ?? 'browserDownload',
            includeAssets: settings.includeAssets, skipUnchanged: settings.skipExported }, fonts);
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
            .catch(e => status(errorText(e), 'error'));
    });
    el('btnSetDir').addEventListener('click', () => {
        if (busy || settings?.exportDelivery !== 'folderWriter') return;
        const permission = Directory.getPendingPermissionHandle() ? Directory.reauthorizeDirHandle() : Directory.requestDirHandle();
        void perform('cleanup', async () => {
            if (!await permission) throw new Error(text('Folder permission denied', '目录权限被拒绝'));
            directoryAvailable = await Directory.verifyDirPermission(Directory.getDirHandle());
            status(text('Folder authorized', '目录已授权'));
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
    const fileInput = el<HTMLInputElement>('takeoutFileInput');
    el('btnImportTakeout').addEventListener('click', () => { if (!busy) fileInput.click(); });
    const importFile = (file: File) => perform('takeout', async () => {
        status(text('Importing Takeout ZIP…', '正在导入 Takeout ZIP…'));
        try {
            const result = await handleTakeoutImport(file, state.accountId, { onTarget: select,
                onProgress: percent => progress(text(`Importing ${percent}%`, `正在导入 ${percent}%`), percent) });
            status(text(`Imported ${result.imported} conversations (${result.status})`, `已提交 ${result.imported} 条对话（${result.status}）`));
        } finally { fileInput.value = ''; }
    });
    fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void importFile(file); });
    el('btnImportTakeout').addEventListener('dragover', event => event.preventDefault());
    el('btnImportTakeout').addEventListener('drop', event => {
        event.preventDefault();
        const file = (event as DragEvent).dataTransfer?.files[0];
        if (file && !busy) void importFile(file);
    });
    for (const [id, scanRecords] of [['btnClearExported', false], ['btnClearScan', true]] as const)
        el(id).addEventListener('click', () => {
            const accountId = state.accountId;
            if (!accountId || busy || !window.confirm(scanRecords
                ? text('Clear scan coverage and export records? Conversations and files stay. The next scan will retry history within source and local limits.', '清除扫描覆盖及导出记录？保留对话和磁盘文件。下次扫描将在来源范围和本地预算内重新尝试历史。')
                : text('Clear export records? Conversations and files are kept.', '清除导出记录？保留对话和文件。'))) return;
            void perform('cleanup', async () => {
                if (scanRecords) await Cleanup.clearLocalScanRecords(accountId);
                else await Cleanup.clearLocalExportRecords(accountId);
                failed = []; dismissedFailures = false;
                status(text('Records cleared', '记录已清除'));
            });
        });
    el<HTMLSelectElement>('accountIdSelect').addEventListener('change', () => {
        if (busy) { render(); return; }
        void select(el<HTMLSelectElement>('accountIdSelect').value).catch(e => status(errorText(e), 'error'));
    });
    el<HTMLInputElement>('chatSearchInput').addEventListener('input', () => {
        state.search = el<HTMLInputElement>('chatSearchInput').value; renderList(state, busy);
    });
    el<HTMLSelectElement>('chatFilterSelect').addEventListener('change', () => {
        state.filter = el<HTMLSelectElement>('chatFilterSelect').value; renderList(state, busy);
    });
    el('btnSelectAll').addEventListener('click', () => { state.selectVisible(); renderList(state, busy); });
    el('btnSelectNone').addEventListener('click', () => { state.selected.clear(); renderList(state, busy); });
    const settingControls = { format: 'defaultFormat', skipExported: 'skipExported',
        includeAssets: 'includeAssets', liveSaveDiskToggle: 'enabledDisk',
        devToggle: 'developerMode' } as const;
    for (const [id, field] of Object.entries(settingControls)) el<HTMLInputElement>(id).addEventListener('change', () => {
        const input = el<HTMLInputElement>(id);
        // A disabled Live Save switch must never mutate persisted intent.
        if (busy || input.disabled) { render(); return; }
        const value = input.type === 'checkbox' ? input.checked : input.value;
        const prior = settings; settings = { ...settings, [field]: value };
        void perform('cleanup', async () => {
            try { await updateSettings({ [field]: value }); settings = await readSettings(); }
            catch (error) { settings = prior; throw error; }
        });
    });
    el<HTMLButtonElement>('btnThemeToggle').addEventListener('click', () => {
        if (!settings || themeSaving) return;
        const previous = settings;
        const theme = settings.theme === 'light' ? 'dark' : 'light';
        themeSaving = true;
        settings = { ...settings, theme };
        useSettings(settings);
        render();
        void updateSettings({ theme }).then(async () => { settings = await readSettings(); })
            .catch(error => { settings = previous; useSettings(previous); status(errorText(error), 'error'); })
            .finally(() => { themeSaving = false; render(); });
    });
    el<HTMLInputElement>('langToggle').addEventListener('change', () => {
        if (busy || !settings) { render(); return; }
        const language = el<HTMLInputElement>('langToggle').checked ? 'en' : 'zh';
        const prior = settings;
        settings = { ...settings, language }; useSettings(settings);
        void perform('cleanup', async () => {
            try { await updateSettings({ language }); settings = await readSettings(); }
            catch (error) { settings = prior; useSettings(prior); throw error; }
        });
    });
    el('logFilter').addEventListener('input', renderLog);
    el('logLevel').addEventListener('change', renderLog);
    el('btnCopyLog').addEventListener('click', () => {
        void navigator.clipboard.writeText(el('log').textContent ?? '').catch(e => status(errorText(e), 'error'));
    });
    el('btnClearLog').addEventListener('click', () => { log.length = 0; renderLog(); });
    el('btnExportDiag').addEventListener('click', () => {
        const payload = JSON.stringify({ generatedAt: Date.now(), accountId: state.accountId, scanRuns, logs: log }, null, 2);
        const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'gemini-exporter-ui-diagnostics.json';
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    el('btnTourGuide').addEventListener('click', () => { if (!busy) void TourGuide.startTour(); });
    const stopSettings = observeSettings(() => {
        void readSettings().then(next => { settings = next; render(); }).catch(e => status(errorText(e), 'error'));
    });
    const onFocus = () => {
        if (busy) return;
        void (async () => {
            await refresh();
            try { directoryAvailable = await Directory.verifyDirPermission(Directory.getDirHandle()); }
            catch (error) { directoryAvailable = false; status(errorText(error), 'warn'); }
            render();
        })().catch(e => status(errorText(e), 'error'));
    };
    const onDomainChanged = (message: unknown, sender: chrome.runtime.MessageSender): void => {
        if (sender.id !== chrome.runtime.id || sender.tab
            || sender.url && !sender.url.startsWith(chrome.runtime.getURL(''))
            || !message || typeof message !== 'object' || !('action' in message) || message.action !== 'domainChanged'
            || !('accountId' in message) || typeof message.accountId !== 'string') return;
        void refresh().catch(e => status(errorText(e), 'error'));
    };
    chrome.runtime.onMessage.addListener(onDomainChanged);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', () => {
        stopSettings(); chrome.runtime.onMessage.removeListener(onDomainChanged);
        window.removeEventListener('focus', onFocus); TourGuide.destroy();
    }, { once: true });
    renderLog(); render();
    await ensureV2Ready();
    settings = await readSettings();
    await refresh();
    try {
        await Directory.restoreSavedDirHandle();
        directoryAvailable = await Directory.verifyDirPermission(Directory.getDirHandle());
    } catch (error) {
        directoryAvailable = false;
        status(text('Folder permission could not be restored: ', '无法恢复文件夹权限：') + errorText(error), 'warn');
    }
    render();
    if (installationTour) await TourGuide.startTour();
    else {
        const current = chrome.runtime.getManifest().version;
        const feature = getLatestEligibleFeature(settings.lastSeenFeatureVersion ?? current, current);
        if (feature) TourGuide.startFeatureSpotlight(feature.version, feature.stepId, () => {
            void updateSettings({ lastSeenFeatureVersion: feature.version });
        });
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
