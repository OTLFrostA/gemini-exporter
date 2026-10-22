import { exportSummary } from '../shared/exportSummary.js';
import { sendTabMessage } from '../../runtime/capabilities/tabService.js';
import { isAccountId } from '../../l2/accountRegistry.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import { getIndex } from '../../l3a/storageService.js';
import { updateSettings, type GlobalSettings } from '../../application/settings/index.js';
import { ensureV2Ready } from '../../runtime/api/runtimeReady.js';
import { warmLocalFontCache } from '../../l4/format/pdf/typst/fonts/localFontProvider.js';
import { runExport } from '../options/controllers/exportController.js';
import { readSettings, observeSettings, useSettings, text, errorText, labelPage, labelThemeToggle } from '../shared/settings.js';

/** Current source identity comes only from trusted Content; never infer Account from a tab URL. */
export async function readActiveKey(): Promise<ConversationKey | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined || !tab.url) return null;
    const origin = new URL(tab.url).origin;
    const expectedProvider = origin === 'https://gemini.google.com' ? 'gemini'
        : ['https://chatgpt.com', 'https://chat.openai.com'].includes(origin) ? 'chatgpt' : null;
    if (!expectedProvider) return null;
    const raw = await sendTabMessage(tab.id, { action: 'getAccountContext' }, 3000);
    if (!raw || typeof raw !== 'object') return null;
    const response = raw as { ok?: unknown; accountContext?: { accountId?: unknown; providerId?: unknown }; conversationId?: unknown };
    if (response.ok !== true || !isAccountId(response.accountContext?.accountId)
        || response.accountContext?.providerId !== expectedProvider || typeof response.conversationId !== 'string' || !response.conversationId)
        return null;
    return { accountId: response.accountContext.accountId, conversationId: response.conversationId };
}

export async function initPopup(): Promise<void> {
    const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
    const button = el<HTMLButtonElement>('btnCurrent');
    const status = el('status');
    let currentStatus: (() => string) | null = null;
    const showStatus = (message: () => string) => { currentStatus = message; status.textContent = message(); };
    const showError = (error: unknown) => showStatus(() => errorText(error));
    let settings: GlobalSettings;
    let key: ConversationKey | null = null;
    let indexTitle: string | null = null;
    let identityLoaded = false;
    let busy = false, active = true;
    let themeSaving = false;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-format]')];
    const formatName: Record<string, string> = { markdown: 'Markdown', html: 'HTML', pdf: 'PDF', json: 'JSON' };
    const render = () => {
        labelPage();
        labelThemeToggle(el<HTMLButtonElement>('btnThemeToggle'), settings);
        // Appearance is independent of exporting or updating another preference.
        el<HTMLButtonElement>('btnThemeToggle').disabled = !settings || themeSaving;
        if (identityLoaded) el('currentChatTitle').textContent = indexTitle || (key
            ? text('Current conversation', '当前对话')
            : text('No current supported conversation', '当前没有受支持的对话'));
        button.disabled = busy || !key;
        for (const btn of buttons) {
            const current = btn.dataset.format === settings?.defaultFormat;
            btn.disabled = busy || !settings;
            btn.classList.toggle('active', current);
            btn.setAttribute('aria-pressed', String(current));
        }
        if (settings) {
            el('activeFormatLabel').textContent = formatName[settings.defaultFormat] || settings.defaultFormat;
        }
        if (currentStatus) status.textContent = currentStatus();
    };
    const refresh = async () => { settings = await readSettings(); if (active) render(); };
    const stop = observeSettings(() => { void refresh().catch(e => { showError(e); }); });
    window.addEventListener('pagehide', () => { active = false; stop(); }, { once: true });
    el('btnOptions').addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
    const changeSettings = (patch: Partial<GlobalSettings>) => {
        if (busy) return;
        const prior = settings;
        busy = true; settings = { ...settings, ...patch }; useSettings(settings); render();
        void updateSettings(patch).then(refresh).catch(e => {
            settings = prior; useSettings(prior); showError(e);
        }).finally(() => { busy = false; render(); });
    };
    el<HTMLButtonElement>('btnThemeToggle').addEventListener('click', () => {
        if (!settings || themeSaving) return;
        const previousTheme = settings.theme;
        const theme = previousTheme === 'light' ? 'dark' : 'light';
        themeSaving = true;
        settings = { ...settings, theme };
        useSettings(settings); render();
        void updateSettings({ theme }).then(refresh)
            .catch(error => {
                settings = { ...settings, theme: previousTheme };
                useSettings(settings);
                showError(error);
            })
            .finally(() => { themeSaving = false; render(); });
    });
    for (const btn of buttons) btn.addEventListener('click', () => {
        changeSettings({ defaultFormat: btn.dataset.format as GlobalSettings['defaultFormat'] });
    });
    button.addEventListener('click', () => {
        if (busy || !key || !settings) return;
        const format = settings.defaultFormat;
        // Local Font Access starts inside this gesture, before any await.
        const fonts = format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
        busy = true; render();
        showStatus(() => text('Preparing export…', '正在准备导出…'));
        void (async () => {
            const [current, latest] = await Promise.all([readActiveKey(), readSettings(), fonts]);
            if (!current) { key = null; throw new Error('No trusted current conversation'); }
            const result = await runExport({ keys: [current], format, delivery: 'browserDownload',
                includeAssets: latest.includeAssets, skipUnchanged: false });
            if (!active) return;
            showStatus(() => result.aborted ? text('Cancelled', '已取消')
                : result.failed.length || !result.exported ? text('Export failed. Try Options.', '导出失败，请在工作台重试。')
                : result.partial ? exportSummary(result)
                : text('Download initiated', '已发起下载'));
        })().catch(e => { if (active) showError(e); })
            .finally(() => {
                if (active) { busy = false; render(); }
            });
    });
    render();
    try {
        await ensureV2Ready();
        await refresh();
        key = await readActiveKey();
        const index = key ? await getIndex(key) : null;
        indexTitle = index?.title || null;
        identityLoaded = true;
        if (!key) showStatus(() => text('Open a supported conversation first', '请先打开受支持的对话'));
    } catch (error) { showError(error); }
    render();
}
if (typeof document !== 'undefined') {
    const start = () => { void initPopup(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}
