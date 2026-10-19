import { sendTabMessage } from '../../core/utils/tabService.js';
import { isAccountId } from '../../core/domain/accountRegistry.js';
import type { ConversationKey } from '../../core/domain/conversationKey.js';
import { getIndex } from '../../core/storage/storageService.js';
import { updateSettings, type GlobalSettings } from '../../core/application/settings/index.js';
import { ensureV2Ready } from '../../core/api/runtimeReady.js';
import { warmLocalFontCache } from '../../core/export/typst/fonts/localFontProvider.js';
import { runExport } from '../controllers/exportController.js';
import { readSettings, observeSettings, text, errorText, labelPage } from '../utils/settings.js';

export async function readActiveKey(): Promise<ConversationKey | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    const raw = await sendTabMessage(tab.id, { action: 'getAccountContext' });
    if (!raw || typeof raw !== 'object') return null;
    const response = raw as { ok?: unknown; accountContext?: { accountId?: unknown; providerId?: unknown }; conversationId?: unknown };
    if (response?.ok !== true || !isAccountId(response.accountContext?.accountId)
        || response.accountContext.providerId !== 'gemini' || typeof response.conversationId !== 'string' || !response.conversationId) return null;
    return { accountId: response.accountContext.accountId, conversationId: response.conversationId };
}

export async function initPopup(): Promise<void> {
    const button = document.getElementById('btnCurrent') as HTMLButtonElement;
    const status = document.getElementById('status')!;
    const title = document.getElementById('currentChatTitle')!;
    let settings: GlobalSettings;
    let key: ConversationKey | null = null;
    let busy = false, active = true;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-format]')];
    const render = () => {
        labelPage();
        button.disabled = busy || !key;
        for (const btn of buttons) {
            btn.disabled = busy || !settings;
            btn.setAttribute('aria-pressed', String(btn.dataset.format === settings?.defaultFormat));
        }
    };
    const refresh = async () => {
        settings = await readSettings();
        if (active) render();
    };
    const stop = observeSettings(() => { void refresh().catch(e => { status.textContent = errorText(e); }); });
    window.addEventListener('pagehide', () => { active = false; stop(); }, { once: true });
    document.getElementById('btnOptions')!.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
    for (const btn of buttons) btn.addEventListener('click', () => {
        if (busy) return;
        busy = true; render();
        void updateSettings({ defaultFormat: btn.dataset.format as GlobalSettings['defaultFormat'] })
            .then(refresh).catch(e => { status.textContent = errorText(e); }).finally(() => { busy = false; render(); });
    });
    button.addEventListener('click', () => {
        if (busy || !key) return;
        const format = settings.defaultFormat;
        // Invoke Local Font Access synchronously in this click, before all other async work.
        const fonts = format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
        busy = true; render(); status.textContent = text('Processing…', '正在处理…');
        void (async () => {
            const [current, latest] = await Promise.all([readActiveKey(), readSettings(), fonts]);
            if (!current) { key = null; throw new Error(text('No trusted current conversation', '无法确认当前对话')); }
            const result = await runExport({ keys: [current], format, delivery: 'browserDownload',
                includeAssets: latest.includeAssets, skipUnchanged: false });
            if (!active) return;
            status.textContent = result.aborted ? text('Cancelled', '已取消')
                : result.failed.length || !result.exported ? text('Export failed. Try Options.', '导出失败，请在工作台重试。')
                : result.partial ? text('Download initiated; some content is missing', '已发起下载，部分内容缺失')
                : text('Download initiated', '已发起下载');
        })().catch(e => { if (active) status.textContent = errorText(e); })
            .finally(() => { if (active) { busy = false; render(); } });
    });
    render();
    try {
        await ensureV2Ready(); await refresh(); key = await readActiveKey();
        const index = key ? await getIndex(key) : null;
        title.textContent = index?.title || text('Current conversation', '当前对话');
        if (!key) status.textContent = text('Open a supported conversation first', '请先打开受支持的对话');
    } catch (e) { status.textContent = errorText(e); }
    render();
}
if (typeof document !== 'undefined') void initPopup();
