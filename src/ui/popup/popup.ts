import { sendTabMessage } from '../../core/utils/tabService.js';
import { isAccountId } from '../../core/domain/accountRegistry.js';
import type { ConversationKey } from '../../core/domain/conversationKey.js';
import { getIndex, getDetail, listIndexes } from '../../core/storage/storageService.js';
import { updateSettings, type GlobalSettings } from '../../core/application/settings/index.js';
import { ensureV2Ready } from '../../core/api/runtimeReady.js';
import { warmLocalFontCache } from '../../core/export/typst/fonts/localFontProvider.js';
import { runExport } from '../controllers/exportController.js';
import { readSettings, observeSettings, useSettings, text, errorText, labelPage } from '../utils/settings.js';

/** Current source identity comes only from trusted Content; never infer Account from a tab URL. */
export async function readActiveKey(): Promise<ConversationKey | null> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    const raw = await sendTabMessage(tab.id, { action: 'getAccountContext' });
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
    let busy = false, active = true;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-format]')];
    const formatName: Record<string, string> = { markdown: 'Markdown', html: 'HTML', pdf: 'PDF', json: 'JSON' };
    const render = () => {
        labelPage();
        button.disabled = busy || !key;
        for (const btn of buttons) {
            const current = btn.dataset.format === settings?.defaultFormat;
            btn.disabled = busy || !settings;
            btn.classList.toggle('active', current);
            btn.setAttribute('aria-pressed', String(current));
        }
        if (settings) {
            el('activeFormatLabel').textContent = formatName[settings.defaultFormat] || settings.defaultFormat;
            el<HTMLSelectElement>('format').value = settings.defaultFormat;
            const en = !document.documentElement.lang.startsWith('zh');
            el<HTMLInputElement>('langToggle').checked = en;
            el('labelLangEn').style.color = en ? 'var(--text)' : 'var(--muted)';
            el('labelLangZh').style.color = en ? 'var(--muted)' : 'var(--text)';
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
    for (const btn of buttons) btn.addEventListener('click', () => {
        changeSettings({ defaultFormat: btn.dataset.format as GlobalSettings['defaultFormat'] });
    });
    el<HTMLInputElement>('langToggle').addEventListener('change', () => {
        changeSettings({ language: el<HTMLInputElement>('langToggle').checked ? 'en' : 'zh' });
    });
    button.addEventListener('click', () => {
        if (busy || !key || !settings) return;
        const format = settings.defaultFormat;
        // Local Font Access starts inside this gesture, before any await.
        const fonts = format === 'pdf' ? warmLocalFontCache() : Promise.resolve();
        busy = true; render();
        status.textContent = text('Preparing export…', '正在准备导出…');
        el<HTMLElement>('progWrap').style.display = 'block';
        el<HTMLElement>('bar').style.width = '0%';
        void (async () => {
            const [current, latest] = await Promise.all([readActiveKey(), readSettings(), fonts]);
            if (!current) { key = null; throw new Error(text('No trusted current conversation', '无法确认当前对话')); }
            const result = await runExport({ keys: [current], format, delivery: 'browserDownload',
                includeAssets: latest.includeAssets, skipUnchanged: false }, {
                onProgress: p => {
                    if (!active) return;
                    el<HTMLElement>('bar').style.width = p.total ? `${Math.round(p.current / p.total * 100)}%` : '0%';
                }
            });
            if (!active) return;
            status.textContent = result.aborted ? text('Cancelled', '已取消')
                : result.failed.length || !result.exported ? text('Export failed. Try Options.', '导出失败，请在工作台重试。')
                : result.partial ? text('Download initiated; some content is missing', '已发起下载，部分内容缺失')
                : text('Download initiated', '已发起下载');
        })().catch(e => { if (active) status.textContent = errorText(e); })
            .finally(() => {
                if (active) { busy = false; render(); el<HTMLElement>('progWrap').style.display = 'none'; }
            });
    });
    render();
    try {
        await ensureV2Ready();
        await refresh();
        key = await readActiveKey();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        el<HTMLElement>('notGeminiNotice').style.display =
            tab?.url?.startsWith('https://gemini.google.com/') ? 'none' : 'block';
        const [index, detail, indexes] = await Promise.all([
            key ? getIndex(key) : Promise.resolve(null),
            key ? getDetail(key) : Promise.resolve(null),
            key ? listIndexes(key.accountId) : Promise.resolve([])
        ]);
        el('currentChatTitle').textContent = index?.title || (key ? text('Current conversation', '当前对话')
            : text('No current Gemini conversation', '当前没有 Gemini 对话'));
        el('countBadge').textContent = String(indexes.length);
        el('chatTurnBadge').textContent = detail?.messages.length
            ? text(`${detail.messages.length} messages`, `${detail.messages.length} 条消息`)
            : text('New chat', '新会话');
        if (!key) status.textContent = text('Open a supported conversation first', '请先打开受支持的对话');
    } catch (error) { status.textContent = errorText(error); }
    render();
}
if (typeof document !== 'undefined') {
    const start = () => { void initPopup(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
}
