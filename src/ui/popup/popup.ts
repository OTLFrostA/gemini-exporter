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
    if (tab?.id === undefined || tab.url && !tab.url.startsWith('https://gemini.google.com/')) return null;
    const raw = await sendTabMessage(tab.id, { action: 'getAccountContext' }, 3000);
    if (!raw || typeof raw !== 'object') return null;
    const response = raw as { ok?: unknown; accountContext?: { accountId?: unknown; providerId?: unknown }; conversationId?: unknown };
    if (response.ok !== true || !isAccountId(response.accountContext?.accountId)
        || response.accountContext?.providerId !== 'gemini' || typeof response.conversationId !== 'string' || !response.conversationId)
        return null;
    return { accountId: response.accountContext.accountId, conversationId: response.conversationId };
}

export async function initPopup(): Promise<void> {
    const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
    const button = el<HTMLButtonElement>('btnCurrent');
    const status = el('status');
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
            : text('No current Gemini conversation', '当前没有 Gemini 对话'));
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
    };
    const refresh = async () => { settings = await readSettings(); if (active) render(); };
    const stop = observeSettings(() => { void refresh().catch(e => { status.textContent = errorText(e); }); });
    window.addEventListener('pagehide', () => { active = false; stop(); }, { once: true });
    el('btnOptions').addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
    const changeSettings = (patch: Partial<GlobalSettings>) => {
        if (busy) return;
        const prior = settings;
        busy = true; settings = { ...settings, ...patch }; useSettings(settings); render();
        void updateSettings(patch).then(refresh).catch(e => {
            settings = prior; useSettings(prior); status.textContent = errorText(e);
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
                status.textContent = errorText(error);
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
        status.textContent = text('Preparing export…', '正在准备导出…');
        void (async () => {
            const [current, latest] = await Promise.all([readActiveKey(), readSettings(), fonts]);
            if (!current) { key = null; throw new Error(text('No trusted current conversation', '无法确认当前对话')); }
            const result = await runExport({ keys: [current], format, delivery: 'browserDownload',
                includeAssets: latest.includeAssets, skipUnchanged: false });
            if (!active) return;
            status.textContent = result.aborted ? text('Cancelled', '已取消')
                : result.failed.length || !result.exported ? text('Export failed. Try Options.', '导出失败，请在工作台重试。')
                : result.partial ? exportSummary(result)
                : text('Download initiated', '已发起下载');
        })().catch(e => { if (active) status.textContent = errorText(e); })
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
        if (!key) status.textContent = text('Open a supported conversation first', '请先打开受支持的对话');
    } catch (error) { status.textContent = errorText(error); }
    render();
}
if (typeof document !== 'undefined') {
    const start = () => { void initPopup(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}
