import { getSettings, updateSettings, runExport, type ExportFormat } from '../../core/application/index.js';
import { listIndexes } from '../../core/storage/storageService.js';
import { readConversation } from '../../core/domain/readConversation.js';
import { isAccountId } from '../../core/domain/accountRegistry.js';
import { SETTINGS_KEY } from '../../core/storage/settingsStore.js';
import { cleanTitle } from '../../core/utils/utils.js';
import { isGeminiUrl } from '../../core/utils/pathUtils.js';
import { $, getI18n } from '../uiCommon.js';
import { getErrorMessage } from '../../core/utils/messaging.js';
import { ProgressView } from '../views/progressView.js';

const formats = ['markdown', 'html', 'json', 'pdf'] as const;
const normalizeFormat = (value: string): ExportFormat => formats.includes(value as ExportFormat) ? value as ExportFormat : 'markdown';
let exporting = false;
let exportCancellation: AbortController | null = null;
let contextGeneration = 0;
let _activeConvId: string | null = null;
let _activeAccountId = '';
let _activeChatTitle: string = '';
let _activeFormat = 'markdown';

function updateFormatTabsUI(targetFormat: string): void {
    _activeFormat = normalizeFormat(targetFormat);
    const tabBtns = document.querySelectorAll('#formatTabs .tab-btn') as NodeListOf<HTMLButtonElement>;
    tabBtns.forEach(btn => {
        const val = btn.getAttribute('data-value');
        if (val === _activeFormat) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    const activeLabel = $('activeFormatLabel');
    if (activeLabel) {
        const activeBtn = document.querySelector(`#formatTabs .tab-btn[data-value="${_activeFormat}"]`) as HTMLButtonElement | null;
        activeLabel.textContent = activeBtn?.textContent?.trim() || _activeFormat;
    }
    const formatSelect = $('format') as HTMLSelectElement | null;
    if (formatSelect && formatSelect.value !== _activeFormat) {
        formatSelect.value = _activeFormat;
    }
}

const log = (msg: string): void => {
    try {
        if (typeof console !== 'undefined') console.log('[GemExporter:popup]', msg);
        const el = document.getElementById('log');
        if (el) {
            el.style.display = '';
            const line = document.createElement('div');
            line.textContent = msg;
            el.appendChild(line);
            el.scrollTop = el.scrollHeight;
        }
    } catch {}
};

function updateUiForTabState(isGemini: boolean): void {
    const btnCurrent = $('btnCurrent') as HTMLButtonElement | null;
    const notGeminiNotice = $('notGeminiNotice');
    const currentChatContent = $('currentChatContent');
    const countBadge = $('countBadge');
    const i18n = getI18n();

    if (!isGemini) {
        const notGeminiTip = i18n.t('popupNotGemini');
        if (btnCurrent) {
            btnCurrent.disabled = true;
            btnCurrent.title = notGeminiTip;
        }
        if (notGeminiNotice) notGeminiNotice.style.display = '';
        if (currentChatContent) currentChatContent.style.display = 'none';
        if (countBadge) countBadge.classList.add('inactive');
    } else {
        if (btnCurrent) {
            btnCurrent.disabled = false;
            btnCurrent.title = '';
        }
        if (notGeminiNotice) notGeminiNotice.style.display = 'none';
        if (currentChatContent) currentChatContent.style.display = '';
        if (countBadge) countBadge.classList.remove('inactive');
    }
}

export async function updateCount(): Promise<void> {
    const ticket = ++contextGeneration;
    // Clear the previous binding before awaiting; a failed lookup cannot reuse another tab's account.
    _activeAccountId = '';
    _activeConvId = null;
    updateUiForTabState(false);
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url || !isGeminiUrl(tab.url) || tab.id == null) return;
        const binding: unknown = await chrome.tabs.sendMessage(tab.id, { action: 'getAccountContext' });
        if (!binding || typeof binding !== 'object' || !('accountContext' in binding)) throw new Error('Account unavailable');
        const context = binding.accountContext;
        if (!context || typeof context !== 'object' || !('accountId' in context) || !isAccountId(context.accountId)) throw new Error('Account unavailable');
        const accountId = context.accountId;
        const conversationId = 'conversationId' in binding && typeof binding.conversationId === 'string' && binding.conversationId.trim() ? binding.conversationId : null;
        const [indexes, conversation] = await Promise.all([listIndexes(accountId),
            conversationId ? readConversation({ accountId, conversationId }) : null]);
        if (ticket !== contextGeneration) return;
        _activeAccountId = accountId;
        _activeConvId = conversationId;
        updateUiForTabState(true);
        const button = $('btnCurrent') as HTMLButtonElement | null;
        if (button) button.disabled = exporting || !conversationId;
        _activeChatTitle = cleanTitle(indexes.find(row => row.key.conversationId === conversationId)?.title || tab.title || conversationId || '');
        const title = $('currentChatTitle');
        if (title) title.textContent = _activeChatTitle;
        const turns = $('chatTurnBadge');
        if (turns) turns.textContent = getI18n().t('chatMessagesCount', conversation?.detail.messages.length || 0);
        const badge = $('countBadge');
        if (badge) badge.textContent = getI18n().t('syncedBadge', indexes.length);
    } catch (error) { log(getErrorMessage(error)); }
}

const handleLangChange = async (targetLang: string): Promise<void> => {
    const i18n = getI18n();
    if (i18n && typeof i18n.setLang === 'function') {
        await i18n.setLang(targetLang);
        document.documentElement.lang = targetLang === 'zh' ? 'zh-CN' : 'en';
        if (typeof i18n.applyI18n === 'function') i18n.applyI18n();
        if (typeof i18n.applyLangToggleUI === 'function') i18n.applyLangToggleUI();
        updateFormatTabsUI(_activeFormat);
        await updateCount();
    }
};

function initPopupEvents(): void {
    const langToggle = $('langToggle') as HTMLInputElement | null;
    langToggle?.addEventListener('change', (e: Event) => {
        void handleLangChange((e.target as HTMLInputElement).checked ? 'en' : 'zh');
    });

    $('labelLangZh')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (langToggle) langToggle.checked = false;
        void handleLangChange('zh');
    });

    $('labelLangEn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (langToggle) langToggle.checked = true;
        void handleLangChange('en');
    });

    $('langTogglePill')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement | null;
        if (target && (target.id === 'langToggle' || target.id === 'labelLangZh' || target.id === 'labelLangEn')) {
            return;
        }
        const i18n = getI18n();
        const current = i18n && typeof i18n.getLang === 'function' ? i18n.getLang() : 'zh';
        const nextLang = current === 'zh' ? 'en' : 'zh';
        if (langToggle) langToggle.checked = (nextLang === 'en');
        void handleLangChange(nextLang);
    });

    const formatSelect = $('format') as HTMLSelectElement | null;
    void getSettings().then(settings => {
        updateFormatTabsUI(settings.defaultFormat);
        document.body.classList.toggle('dev-mode', settings.developerMode);
    });

    const tabBtns = document.querySelectorAll('#formatTabs .tab-btn') as NodeListOf<HTMLButtonElement>;
    tabBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const val = btn.getAttribute('data-value');
            if (val) {
                await updateSettings({ defaultFormat: normalizeFormat(val) });
                updateFormatTabsUI(val);
            }
        });
    });

    formatSelect?.addEventListener('change', (e: Event) => {
        const val = (e.target as HTMLSelectElement).value;
        void updateSettings({ defaultFormat: normalizeFormat(val) });
        updateFormatTabsUI(val);
    });

    $('btnOptions')?.addEventListener('click', () => chrome.runtime.openOptionsPage());

    $('btnCurrent')?.addEventListener('click', () => { void exportCurrent(); });
    window.addEventListener('pagehide', () => exportCancellation?.abort());
    chrome.runtime.onMessage.addListener((message: { action?: string; accountId?: string }) => {
        if (message.action === 'syncUpdate' && (!message.accountId || message.accountId === _activeAccountId)) void updateCount();
    });

    const i18n = getI18n();
    void i18n.initLanguage().then(async () => {
        i18n.applyI18n();
        i18n.applyLangToggleUI();
        i18n.onLanguageChange(() => i18n.applyLangToggleUI());
        try {
            void updateCount();
        } catch (e) {
            console.warn('[popup] storage not ready', e);
        }
    });

    chrome.storage?.onChanged?.addListener((changes, area) => {
        if (area !== 'local' || !changes[SETTINGS_KEY]) return;
        void getSettings().then(settings => {
            updateFormatTabsUI(settings.defaultFormat);
            document.body.classList.toggle('dev-mode', settings.developerMode);
            if (settings.language && settings.language !== getI18n().getLang()) {
                const i18n = getI18n();
                void i18n.initLanguage().then(() => { i18n.applyI18n(); i18n.applyLangToggleUI(); });
            }
        });
    });
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.addListener(() => updateCount());
    }
}

export async function exportCurrent(): Promise<void> {
    if (exporting) return;
    exporting = true;
    exportCancellation = new AbortController();
    try {
        await updateCount();
        const key = { accountId: _activeAccountId, conversationId: _activeConvId || '' };
        if (!key.accountId || !key.conversationId) throw new Error(getI18n().t('popupNoChatId'));
        const settings = await getSettings();
        const format = normalizeFormat(_activeFormat);
        if (format === 'pdf') { log(getI18n().t('popupPdfUseOptions')); return; }
        ProgressView.show(0);
        const result = await runExport({ keys: [key], format, delivery: 'browserDownload',
            useZip: settings.useZip, includeAssets: settings.includeAssets, skipUnchanged: false }, {
            signal: exportCancellation.signal,
            onProgress: progress => ProgressView.update(progress.total ? progress.current / progress.total * 100 : 0)
        });
        const message = result.aborted ? getI18n().t('exportAborted')
            : result.failed.length ? getI18n().t('exportFailed', key.conversationId)
            : result.partial ? getI18n().t('exportPartialCount', result.partial)
            : getI18n().t('exportSuccess', result.exported);
        ProgressView.complete(message);
        log(message);
    } catch (error) { log(getErrorMessage(error)); }
    finally {
        exportCancellation = null;
        exporting = false;
        const button = $('btnCurrent') as HTMLButtonElement | null;
        if (button) button.disabled = !_activeAccountId || !_activeConvId;
    }
}

if (typeof document !== 'undefined') initPopupEvents();
