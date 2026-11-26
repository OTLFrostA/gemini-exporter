import { isLiveSaveEffective, type GlobalSettings } from '../../../application/settings/index.js';
import * as Directory from '../../../runtime/capabilities/dirHandleController.js';
import { isSourcePlatform, platformDisplayName } from '../../../shared/platformHosts.js';
import { conversationSourceSummary, type ConversationSourceSummary } from '../../shared/conversationSourceSummary.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { labelPage, labelThemeToggle, text } from '../../shared/settings.js';
import type { ConversationViewState } from '../state/conversationsStore.js';
import type { ScanEvidence, UiMessage } from '../state/foregroundTask.js';

export const resolveUiMessage = (message: UiMessage): string =>
    typeof message === 'function' ? message() : message;

export function resolveSourceMessage(
    message: UiMessage | ConversationSourceSummary,
    state: ConversationViewState,
    scanEvidence?: ScanEvidence,
): string {
    if (typeof message !== 'object') return resolveUiMessage(message);
    const summary = conversationSourceSummary(message, state.indexes.length);
    const result = message.method === 'sync' ? scanEvidence?.result : undefined;
    if (!result || result.status === 'complete' || result.status === 'up_to_date') return summary;
    const selectedProvider = state.accounts.find(a => a.id === state.accountId)?.providerId;
    const platformLabel = isSourcePlatform(selectedProvider) ? platformDisplayName(selectedProvider) : text('source', '来源');
    const reasons = new Map(Object.entries({
        provider_limit: () => text('The online API limit has been reached. Import earlier history with Takeout.', '已达到在线接口上限，更早的历史可以通过 Takeout 导入。'),
        max_pages: () => selectedProvider === 'claude'
            ? text('Claude list coverage cannot yet be verified', 'Claude 列表完整性尚无法验证')
            : text('Local page budget reached', '已达到本地页数预算'),
        invalid_response: () => text(`Scan failed: invalid ${platformLabel} response`, `扫描失败：${platformLabel} 返回无效响应`),
        aborted: () => text('Scan cancelled', '扫描已取消'),
        error: () => text('Scan failed', '扫描失败'),
    }));
    return summary + text('. ', '。') + (reasons.get(result.diagnostics?.failure ?? result.reason ?? result.status)?.()
        ?? (result.status === 'error' ? text('Scan failed', '扫描失败') : text('Scan finished', '扫描已结束')));
}

interface WorkbenchRenderInput {
    readonly state: ConversationViewState;
    readonly settings: GlobalSettings | undefined;
    readonly busy: boolean;
    readonly scanning: boolean;
    readonly scanAborted: boolean;
    readonly presentationSaving: boolean;
    readonly settingsSaving: boolean;
    readonly themeSaving: boolean;
    readonly directoryAvailable: boolean;
    readonly folderSuggestionPending: boolean;
    readonly onCloudBusy: (busy: boolean) => void;
    readonly onRenderConversations: () => void;
    readonly onPaintTaskPanel: () => void;
}

export function renderWorkbench(input: WorkbenchRenderInput): void {
    const {
        state,
        settings,
        busy,
        scanning,
        scanAborted,
        presentationSaving,
        settingsSaving,
        themeSaving,
        directoryAvailable,
        folderSuggestionPending,
        onCloudBusy,
        onRenderConversations,
        onPaintTaskPanel,
    } = input;

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
    labelThemeToggle(control('button', 'btnThemeToggle'), settings);
    control('button', 'btnThemeToggle').disabled = !settings || themeSaving;
    document.body.dataset.busy = String(busy || scanning);
    document.body.dataset.foregroundBusy = String(busy);
    document.body.dataset.scanning = String(scanning);
    onCloudBusy(busy || scanning || !settings);
    document.body.classList.toggle('dev-mode', settings?.developerMode ?? false);

    const controls = [
        ['select', ['accountIdSelect', 'chatFilterSelect']],
        ['input', ['chatSearchInput', 'btnSelectAll']],
        ['button', ['btnSetDir', 'btnExport', 'btnClearExported', 'btnClearScan',
            'btnSyncAll', 'btnForceFullScan', 'btnImportTakeout', 'btnTourGuide', 'btnPlatformPermissions']],
    ] as const;
    for (const [tag, ids] of controls) for (const id of ids) control(tag, id).disabled = busy || !settings;
    const exportSettingsDisabled = busy || !settings || settingsSaving;
    control('select', 'format').disabled = exportSettingsDisabled;
    for (const id of ['skipExported', 'includeAssets']) {
        control('input', id).disabled = exportSettingsDisabled;
    }
    control('input', 'liveSaveDiskToggle').disabled =
        exportSettingsDisabled || settings?.exportDelivery !== 'folderWriter'
        || settings.defaultFormat !== 'markdown' || !directoryAvailable;
    control('select', 'accountIdSelect').disabled ||= scanning;
    control('button', 'btnPlatformPermissions').disabled ||= scanning;
    control('button', 'btnTourGuide').disabled ||= scanning;
    for (const id of ['devToggle', 'langToggle']) {
        control('input', id).disabled = !settings || presentationSaving;
    }

    el('delivery').setAttribute('aria-label', text('Export to', '导出到'));
    const folderSelected = settings?.exportDelivery === 'folderWriter';
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="delivery"]')) {
        radio.checked = radio.value === (settings?.exportDelivery ?? 'browserDownload');
        radio.disabled = exportSettingsDisabled;
    }
    el('localFolderControls').classList.toggle('is-disabled', !folderSelected);
    el('localFolderControls').dataset.authorized = String(folderSelected && directoryAvailable);

    const selector = control('select', 'accountIdSelect');
    selector.setAttribute('aria-label', text('Account', '账户'));
    el('chatSearchInput').setAttribute('aria-label', text('Search title or ID', '搜索标题或 ID'));
    selector.replaceChildren();
    for (const account of state.accounts) {
        const option = document.createElement('option');
        option.value = account.id;
        const provider = platformDisplayName(isSourcePlatform(account.providerId) ? account.providerId : 'gemini');
        option.textContent = `${provider} · ${account.displayName || account.email || account.providerAccountId}`;
        selector.append(option);
    }
    selector.value = state.accountId ?? '';
    selector.style.display = state.accounts.length ? 'inline-flex' : 'none';
    const account = state.accounts.find(a => a.id === state.accountId);
    const name = account?.displayName || account?.email || account?.providerAccountId || text('No local account', '暂无本地账户');
    el('accountName').textContent = state.accounts.length ? '' : text('Connect a platform', '请先连接平台');
    el('accountName').style.display = state.accounts.length ? 'none' : 'inline-flex';
    el('btnImportTakeout').title = text('Import a ZIP archive for the selected platform', '导入当前所选平台的 ZIP 压缩包');
    const zipSupported = !state.accountId || account?.providerId === 'gemini' || account?.providerId === 'chatgpt';
    el('takeoutAccountName').textContent = state.accountId
        ? zipSupported ? `→ ${name}` : text('ZIP import is unavailable for this platform.', '此平台暂不支持 ZIP 导入。')
        : text('First import', '首次导入');
    el('takeoutAccountName').title = state.accountId ? name : text('Creates a default Gemini account after choosing a ZIP', '选定 ZIP 后创建 Gemini 默认账户');
    selector.title = name;
    el('ver').textContent = chrome.runtime.getManifest().version;

    if (settings) {
        control('select', 'format').value = settings.defaultFormat;
        control('input', 'skipExported').checked = settings.exportDelivery !== 'googleDrive' && settings.skipExported;
        control('input', 'skipExported').disabled ||= settings.exportDelivery === 'googleDrive';
        control('input', 'includeAssets').checked = settings.includeAssets;
        control('input', 'devToggle').checked = settings.developerMode;
        const en = !document.documentElement.lang.startsWith('zh');
        control('input', 'langToggle').checked = en;
        el('labelLangEn').classList.toggle('lang-active', en);
        el('labelLangZh').classList.toggle('lang-active', !en);
        el('labelLangEn').style.color = en ? 'var(--text)' : 'var(--muted)';
        el('labelLangZh').style.color = en ? 'var(--muted)' : 'var(--text)';
        control('input', 'liveSaveDiskToggle').checked = settings.enabledDisk;
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
    control('button', 'btnImportTakeout').disabled = busy || scanning || !settings || !zipSupported;
    for (const id of ['btnClearExported', 'btnClearScan']) control('button', id).disabled = busy || scanning || !state.accountId;
    control('button', 'btnForceFullScan').disabled = busy || scanning || !settings?.developerMode;

    const syncButton = control('button', 'btnSyncAll');
    syncButton.disabled = scanning ? scanAborted : busy || !settings;
    syncButton.textContent = scanning
        ? scanAborted ? text('Stopping sync…', '正在停止同步…') : text('Stop sync', '停止同步')
        : text('Sync All', '同步会话');
    syncButton.title = scanning
        ? text('Stop syncing; already saved conversations are kept', '停止同步，已保存的对话会保留')
        : text('Scan and sync conversations for the current account', '扫描并同步当前账号的会话');

    onRenderConversations();
    control('button', 'btnExport').disabled ||= !settings || folderSuggestionPending;
    onPaintTaskPanel();
}
