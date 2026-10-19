import { ensureV2Ready } from '../../core/api/runtimeReady.js';
import { updateSettings, isLiveSaveEffective, type GlobalSettings } from '../../core/application/settings/index.js';
import * as Cleanup from '../../core/application/localCleanup.js';
import { warmLocalFontCache } from '../../core/export/typst/fonts/localFontProvider.js';
import { ConversationViewState } from '../state/conversationsStore.js';
import { runExport, type UIExportRequest } from '../controllers/exportController.js';
import { startSync } from '../controllers/syncController.js';
import { handleTakeoutImport } from '../controllers/takeoutController.js';
import * as Directory from '../controllers/dirHandleController.js';
import { renderList } from '../views/listView.js';
import { readSettings, observeSettings, labelPage, text, errorText } from '../utils/settings.js';
import { TourGuide, consumeTourIntent } from '../tour/tourGuide.js';
import { getLatestEligibleFeature } from '../tour/featureReleases.js';

export async function initWorkbench(): Promise<void> {
    // Consume even if readiness fails: refreshing must not replay installation intent.
    const installationTour = consumeTourIntent();
    const state = new ConversationViewState();
    let settings: GlobalSettings;
    let busy = false;
    let controller: AbortController | null = null;
    let lastRequest: UIExportRequest | null = null;
    let failed: UIExportRequest['keys'] = [];
    const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
    const status = (message: string) => { el('status').textContent = message; };
    const render = () => {
        labelPage(); document.body.dataset.busy = String(busy);
        document.body.classList.toggle('dev-mode', settings?.developerMode ?? false);
        document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('[data-operation]').forEach(node => { node.disabled = busy || !settings; });
        const selector = el<HTMLSelectElement>('accountIdSelect'); selector.replaceChildren();
        for (const account of state.accounts) {
            const option = document.createElement('option'); option.value = account.id;
            option.textContent = account.displayName || account.email || `${account.providerId} · ${account.providerAccountId}`;
            selector.append(option);
        }
        selector.value = state.accountId ?? ''; selector.hidden = state.accounts.length < 2;
        el('accountName').textContent = state.accounts.find(a => a.id === state.accountId)?.displayName
            || state.accounts.find(a => a.id === state.accountId)?.email || state.accounts.find(a => a.id === state.accountId)?.providerAccountId
            || text('No local account', '暂无本地账户');
        el('syncCount').textContent = text(`${state.indexes.length} indexed`, `已收录 ${state.indexes.length} 条`);
        if (settings) {
            el<HTMLSelectElement>('format').value = settings.defaultFormat;
            el<HTMLInputElement>('skipExported').checked = settings.skipExported;
            el<HTMLInputElement>('includeAssets').checked = settings.includeAssets;
            el<HTMLInputElement>('devToggle').checked = settings.developerMode;
            el<HTMLSelectElement>('language').value = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
            el<HTMLInputElement>('liveSaveDiskToggle').checked = settings.enabledDisk;
            el<HTMLInputElement>('liveSaveDiskToggle').disabled = busy || settings.defaultFormat !== 'markdown';
            el('liveSaveStatus').textContent = isLiveSaveEffective(settings, !!Directory.getDirHandle())
                ? text('Live Save active', '自动保存已生效') : text('Live Save inactive or paused; your enabled preference is preserved.', '自动保存未启用或暂时暂停，保留开启意图。');
        }
        const handle = Directory.getDirHandle();
        el('dirLabel').textContent = handle?.name || text('No authorized folder', '无已授权文件夹');
        el<HTMLButtonElement>('btnImportTakeout').disabled = busy || !settings || !!(state.accountId && state.accounts.find(a => a.id === state.accountId)?.providerId !== 'gemini');
        for (const id of ['btnClearExported', 'btnClearScan']) el<HTMLButtonElement>(id).disabled = busy || !state.accountId;
        el('btnCancel').hidden = !controller; el('btnRetryFailed').hidden = !failed.length;
        renderList(state, busy);
    };
    const refresh = async () => { await state.refresh(); render(); };
    const select = async (id: string) => {
        if (id !== state.accountId) { lastRequest = null; failed = []; }
        state.selectAccount(id); render(); await refresh();
    };
    const perform = async (task: () => Promise<void>, cancellable = false) => {
        if (busy) return;
        busy = true; controller = cancellable ? new AbortController() : null; render();
        try { await task(); } catch (error) { status(errorText(error)); }
        finally {
            // Refresh on failure too: earlier commits may have succeeded.
            try { await refresh(); } catch (error) { status(errorText(error)); }
            busy = false; controller = null; render();
        }
    };
    const exportRequest = (request: UIExportRequest, fonts: Promise<void>) => perform(async () => {
        lastRequest = { ...request, keys: request.keys.map(key => ({ ...key })) }; failed = []; render();
        await fonts;
        if (request.delivery === 'folderWriter') {
            if (!await Directory.verifyDirPermission(Directory.getDirHandle())) throw new Error(text('Authorize a folder first', '请先授权文件夹'));
        }
        const result = await runExport(request, { signal: controller!.signal, onProgress: p => {
            status(text(`Processing ${p.current}/${p.total}`, `正在处理 ${p.current}/${p.total}`));
        } });
        failed = result.failed;
        status(text(`Delivery initiated: ${result.exported}; partial: ${result.partial}; skipped: ${result.skipped}; failed: ${result.failed.length}${result.aborted ? '; cancelled' : ''}`,
            `已发起交付 ${result.exported}；部分缺失 ${result.partial}；跳过 ${result.skipped}；失败 ${result.failed.length}${result.aborted ? '；已取消' : ''}`));
    }, true);
    const scan = (forceFull = false) => perform(async () => {
        const signal = controller!.signal;
        status(text('Resolving Gemini source…', '正在确认 Gemini 来源…'));
        const result = await startSync(state.accountId ?? undefined, { signal, forceFull,
            onTarget: select, onProgress: p => status(text(`Committed ${p.pagesFetched} pages, ${p.conversationsFetched} source entries`, `已接纳 ${p.pagesFetched} 页、${p.conversationsFetched} 条来源记录`)) });
        const reasons: Record<string, string> = {
            up_to_date: text('Connected to trusted history coverage', '已衔接可信历史范围'),
            complete: text('Reached the end of this Recent source', '已达到本次 Recent 来源尽头'),
            provider_limit: text('Source online access limit', '来源在线访问范围限制'),
            max_pages: text('Local page budget reached', '已达到本地页数预算'),
            aborted: text('Scan cancelled', '扫描已取消'), error: text('Scan failed', '扫描失败')
        };
        status(`${reasons[result.reason ?? result.status] ?? result.reason ?? result.status} · ${result.pagesFetched} / ${result.conversationsFetched}`);
        settings = await readSettings();
        if (result.conversationsFetched > 150 && !settings.takeoutPromptCompleted) {
            TourGuide.showTakeoutPrompt(() => { void updateSettings({ takeoutPromptCompleted: true }); }, () => el<HTMLInputElement>('takeoutFileInput').click());
        }
    }, true);
    el('btnSyncAll').addEventListener('click', () => { void scan(); });
    el('btnForceFullScan').addEventListener('click', () => { if (settings.developerMode) void scan(true); });
    el('btnCancel').addEventListener('click', () => { controller?.abort(); status(text('Cancelling…', '正在取消…')); });
    el('btnExport').addEventListener('click', () => {
        if (busy || !state.keys().length) return;
        const format = settings.defaultFormat;
        const fonts = format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
        void exportRequest({ keys: state.keys(), format, delivery: el<HTMLSelectElement>('delivery').value as UIExportRequest['delivery'],
            includeAssets: settings.includeAssets, skipUnchanged: settings.skipExported }, fonts);
    });
    el('btnRetryFailed').addEventListener('click', () => {
        if (busy || !lastRequest || !failed.length) return;
        const fonts = lastRequest.format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
        void exportRequest({ ...lastRequest, keys: [...failed], skipUnchanged: false }, fonts);
    });
    el('btnSetDir').addEventListener('click', () => {
        if (busy) return;
        // Start picker/requestPermission directly in the user's gesture.
        const permission = Directory.getPendingPermissionHandle() ? Directory.reauthorizeDirHandle() : Directory.requestDirHandle();
        void perform(async () => { if (!await permission) throw new Error(text('Folder permission denied', '目录权限被拒绝')); });
    });
    const fileInput = el<HTMLInputElement>('takeoutFileInput');
    el('btnImportTakeout').addEventListener('click', () => fileInput.click());
    const importFile = (file: File) => perform(async () => {
        try {
            const result = await handleTakeoutImport(file, state.accountId, { onTarget: select,
                onProgress: percent => status(text(`Importing ${percent}%`, `正在导入 ${percent}%`)) });
            status(text(`Imported ${result.imported} conversations (${result.status})`, `已提交 ${result.imported} 条对话（${result.status}）`));
        } finally { fileInput.value = ''; }
    });
    fileInput.addEventListener('change', () => { const file = fileInput.files?.[0]; if (file) void importFile(file); });
    el('takeoutDropZone').addEventListener('dragover', event => event.preventDefault());
    el('takeoutDropZone').addEventListener('drop', event => {
        event.preventDefault(); const file = event.dataTransfer?.files[0];
        if (file && !busy) void importFile(file);
    });
    for (const [id, scanRecords] of [['btnClearExported', false], ['btnClearScan', true]] as const) el(id).addEventListener('click', () => {
        const accountId = state.accountId;
        if (!accountId || busy || !window.confirm(scanRecords
            ? text('Clear scan coverage and export records for this account? Conversations and files are kept. Future scans remain subject to source limits and local budgets.', '清除此账户扫描覆盖及导出记录？对话和磁盘文件保留；下次扫描仍受来源范围与本地预算限制。')
            : text('Clear export records for this account? Conversations and files are kept.', '清除此账户导出记录？对话和磁盘文件保留。'))) return;
        void perform(async () => {
            if (scanRecords) {
                const cleanup = Cleanup as typeof Cleanup & { clearLocalScanRecords?: (id: string) => Promise<void> };
                if (!cleanup.clearLocalScanRecords) throw new Error('Application clearLocalScanRecords unavailable');
                await cleanup.clearLocalScanRecords(accountId);
            } else await Cleanup.clearLocalExportRecords(accountId);
            status(text('Records cleared', '记录已清除'));
        });
    });
    el<HTMLSelectElement>('accountIdSelect').addEventListener('change', () => { if (!busy) void select(el<HTMLSelectElement>('accountIdSelect').value).catch(e => status(errorText(e))); });
    el<HTMLInputElement>('chatSearchInput').addEventListener('input', () => { state.search = el<HTMLInputElement>('chatSearchInput').value; renderList(state, busy); });
    el<HTMLSelectElement>('chatFilterSelect').addEventListener('change', () => { state.filter = el<HTMLSelectElement>('chatFilterSelect').value; renderList(state, busy); });
    el('btnSelectAll').addEventListener('click', () => { state.selectVisible(); renderList(state, busy); });
    el('btnSelectNone').addEventListener('click', () => { state.selected.clear(); renderList(state, busy); });
    const settingControls = { format: 'defaultFormat', skipExported: 'skipExported', includeAssets: 'includeAssets',
        liveSaveDiskToggle: 'enabledDisk', devToggle: 'developerMode', language: 'language' } as const;
    for (const [id, field] of Object.entries(settingControls)) el<HTMLInputElement>(id).addEventListener('change', () => {
        const input = el<HTMLInputElement>(id);
        const value = input.type === 'checkbox' ? input.checked : input.value;
        void perform(async () => { await updateSettings({ [field]: value }); settings = await readSettings(); });
    });
    el('btnTourGuide').addEventListener('click', () => { void TourGuide.startTour(); });
    const stopSettings = observeSettings(() => { void readSettings().then(next => { settings = next; render(); }).catch(e => status(errorText(e))); });
    const onFocus = () => { if (!busy) void refresh().catch(e => status(errorText(e))); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', () => { stopSettings(); window.removeEventListener('focus', onFocus); TourGuide.destroy(); }, { once: true });
    render();
    await ensureV2Ready(); settings = await readSettings(); await Directory.restoreSavedDirHandle(); await refresh();
    if (installationTour) await TourGuide.startTour();
    else {
        const current = chrome.runtime.getManifest().version;
        const feature = getLatestEligibleFeature(settings.lastSeenFeatureVersion ?? current, current);
        if (feature) TourGuide.startFeatureSpotlight(feature.version, feature.stepId, () => { void updateSettings({ lastSeenFeatureVersion: feature.version }); });
    }
}
if (typeof document !== 'undefined') {
    const start = () => { void initWorkbench().catch(error => { document.getElementById('status')!.textContent = errorText(error); }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
