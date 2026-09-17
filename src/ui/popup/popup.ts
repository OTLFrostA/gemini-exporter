// src/ui/popup/popup.ts - Popup UI controller for Gemini Exporter

import { GeminiUtils, cleanTitle } from '../../core/utils/utils.js';
import { StorageService } from '../../core/storage/storageService.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import { FormatStore } from '../../core/storage/formatStore.js';
import { ChatFormatter } from '../../core/engine/chatFormatter.js';
import {
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName
} from '../../core/utils/pathUtils.js';
import { $, getI18n } from '../uiCommon.js';
import { sendTypedMessage } from '../../core/utils/messaging.js';
import { ProgressView } from '../views/progressView.js';

const getStorage = () => __resolveModule('StorageService', StorageService);

const log = (msg: string): void => {
    try {
        if (typeof console !== 'undefined') console.log('[GemExporter:popup]', msg);
        const el = (typeof document !== 'undefined' ? document.getElementById('log') : null) as HTMLElement | null;
        if (el) {
            el.style.display = '';
            const line = document.createElement('div');
            line.textContent = msg;
            el.appendChild(line);
            el.scrollTop = el.scrollHeight;
        }
    } catch { /* logging must never break the popup itself */ }
};

    function updateUiForTabState(isGemini: boolean): void {
        const btnCurrent = $('btnCurrent') as HTMLButtonElement | null;
        const formatSelect = $('format') as HTMLSelectElement | null;
        const quickExportLabel = document.querySelector('.card:nth-of-type(2) .label');
        const countBadge = $('countBadge');
        const i18n = getI18n();

        if (!isGemini) {
            if (btnCurrent) {
                btnCurrent.disabled = true;
                btnCurrent.title = typeof i18n !== 'undefined' ? i18n.t('popupNotGemini') : '当前页不是 gemini.google.com';
            }
            if (formatSelect) {
                formatSelect.disabled = true;
            }
            if (quickExportLabel) {
                quickExportLabel.classList.add('disabled');
            }
            if (countBadge) {
                countBadge.classList.add('inactive');
            }
        } else {
            if (btnCurrent) {
                btnCurrent.disabled = false;
                btnCurrent.title = '';
            }
            if (formatSelect) {
                formatSelect.disabled = false;
            }
            if (quickExportLabel) {
                quickExportLabel.classList.remove('disabled');
            }
            if (countBadge) {
                countBadge.classList.remove('inactive');
            }
        }
    }

    // Update synced count badge and tab UI state
    async function updateCount(): Promise<void> {
        try {
            let slot = 'u0';
            let isGemini = false;
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.url && isGeminiUrl(tab.url)) {
                isGemini = true;
                slot = detectSlotFromUrl(tab.url);
            }
            updateUiForTabState(isGemini);

            let count = 0;
            const convs = await getStorage().getConversations(slot);
            count = convs.length;
            if (!count) {
                const syncInfo = await getStorage().getLastSync(slot);
                count = syncInfo?.count || 0;
            }
            const badge = $('countBadge');
            if (badge) {
                const i18n = getI18n();
                const text = typeof i18n !== 'undefined' ? i18n.t('syncedBadge', count) : `${count} synced`;
                const label = slot === 'u0' ? text : `${text} (${slot.toUpperCase()})`;
                badge.textContent = isGemini ? label : `${label} (${typeof i18n !== 'undefined' && i18n.getLang?.() === 'zh' ? '离线' : 'offline'})`;
            }
        } catch (e) {
            console.warn('[popup] updateCount err', e);
        }
    }

    // Language switch toggle
    const handleLangChange = async (targetLang: string): Promise<void> => {
        const i18n = getI18n();
        if (i18n && typeof i18n.setLang === 'function') {
            await i18n.setLang(targetLang);
            if (typeof i18n.applyI18n === 'function') i18n.applyI18n();
            if (typeof i18n.applyLangToggleUI === 'function') i18n.applyLangToggleUI();
            await updateCount();
        }
    };

    const langToggle = $('langToggle') as HTMLInputElement | null;
    langToggle?.addEventListener('change', async (e: Event) => {
        const target = e.target as HTMLInputElement;
        handleLangChange(target.checked ? 'en' : 'zh');
    });

    $('labelLangZh')?.addEventListener('click', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const toggle = $('langToggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = false;
        handleLangChange('zh');
    });

    $('labelLangEn')?.addEventListener('click', (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        const toggle = $('langToggle') as HTMLInputElement | null;
        if (toggle) toggle.checked = true;
        handleLangChange('en');
    });

    const formatStore = (typeof FormatStore !== 'undefined')
        ? FormatStore
        : (globalThis as any).FormatStore;
    const ALLOWED_FORMATS: string[] = (typeof formatStore !== 'undefined' ? formatStore.ALLOWED_FORMATS : ['markdown', 'json_openai', 'json', 'json_raw']);
    const formatSelect = $('format') as HTMLSelectElement | null;

    if (typeof formatStore !== 'undefined' && formatStore.loadFormat) {
        formatStore.loadFormat().then(({ format }: { format: string }) => {
            if (formatSelect) formatSelect.value = format;
        });
        formatSelect?.addEventListener('change', (e: Event) => {
            const target = e.target as HTMLSelectElement;
            formatStore.saveFormat(target.value);
        });
    } else {
        chrome.storage.local.get(['gemini_export_format'], (data: any) => {
            if (data.gemini_export_format && formatSelect) {
                const v = String(data.gemini_export_format);
                const valid = ALLOWED_FORMATS.includes(v) && Array.from(formatSelect.options).some(o => o.value === v);
                if (valid) {
                    formatSelect.value = v;
                } else {
                    formatSelect.value = 'markdown';
                    chrome.storage.local.set({ gemini_export_format: 'markdown' });
                }
            }
        });
        formatSelect?.addEventListener('change', (e: Event) => {
            const target = e.target as HTMLSelectElement;
            chrome.storage.local.set({ gemini_export_format: target.value });
        });
    }

    // "去工作台选 批量导出" button
    $('btnOptions')?.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    let __exportingCurrentPage = false;
    $('btnCurrent')?.addEventListener('click', async () => {
        const btnCurrentEl = $('btnCurrent') as HTMLButtonElement | null;
        const i18n = getI18n();
        if (__exportingCurrentPage) {
            log(i18n && typeof i18n.t === 'function' ? i18n.t('popupExportBusy') : '正在导出当前页，请稍候…');
            return;
        }
        __exportingCurrentPage = true;
        if (btnCurrentEl) btnCurrentEl.disabled = true;
        const __releaseExportGuard = (): void => {
            __exportingCurrentPage = false;
            if (btnCurrentEl) btnCurrentEl.disabled = false;
        };
        const currentFormatSelect = $('format') as HTMLSelectElement | null;
        let format: string = (typeof formatStore !== 'undefined' && formatStore.getCurrentFormat)
            ? formatStore.getCurrentFormat(false, currentFormatSelect?.value)
            : (currentFormatSelect?.value || 'markdown');
        if (typeof formatStore === 'undefined' && !ALLOWED_FORMATS.includes(format)) format = 'markdown';

        ProgressView.show(10);

        try {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const tab = tabs[0];
            if (!tab || !tab.url || !isGeminiUrl(tab.url)) {
                log(typeof i18n !== 'undefined' ? i18n.t('popupNotGemini') : '当前页不是 gemini.google.com，请先打开 Gemini 对话页');
                __releaseExportGuard();
                return;
            }
            const slot = detectSlotFromUrl(tab.url);
            const convId = extractConversationIdFromUrl(tab.url);
            if (!convId) {
                log(typeof i18n !== 'undefined' ? i18n.t('popupNoChatId') : '当前页未打开具体对话 (URL 中没找到对话 ID)');
                __releaseExportGuard();
                return;
            }
            log(typeof i18n !== 'undefined' ? i18n.t('popupFoundChat', convId) : `找到对话 ID: ${convId}，正在抓取内容…`);
            ProgressView.update(40);

            sendTypedMessage({ action: 'fetchChat', conversationId: convId, accountSlot: slot }, 40000).then(async (res: any) => {
                try {
                if (!res || !res.success) {
                    log(typeof i18n !== 'undefined' ? i18n.t('popupFetchFailed', res?.error || '未知错误') : ('抓取失败: ' + (res?.error || '未知错误')));
                    return;
                }
                ProgressView.update(80);
                const chat = res.data || res;
                if (!chat.id) chat.id = convId;
                if (!chat.url) chat.url = `https://gemini.google.com/app/${convId}`;
                chat.title = cleanTitle(chat.title);
                if (!chat.title || chat.title === 'Untitled conversation') {
                    try {
                        const list = getStorage() ? await getStorage().getConversations(slot) : [];
                        const found = list.find((c: any) => c.id === convId || c.id === `c_${convId}`);
                        if (found && found.title) chat.title = cleanTitle(found.title);
                    } catch (e) {
                        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:popup.js]', e);
                    }
                }

                const chatFormatter = (typeof ChatFormatter !== 'undefined')
                    ? ChatFormatter
                    : (globalThis as any).ChatFormatter;
                const formatted = (typeof chatFormatter !== 'undefined')
                    ? chatFormatter.formatContent(chat, format)
                    : { content: JSON.stringify(chat, null, 2), ext: 'json', mime: 'application/json' };
                const content = formatted.content;
                const ext = formatted.ext;
                const mime = formatted.mime;

                const fileName = buildExportFileName(cleanTitle(chat.title || chat.id), convId, ext);
                const blob = new Blob([content], { type: mime });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 3000);

                ProgressView.complete();
                log(typeof i18n !== 'undefined' ? i18n.t('popupExported', fileName, chat.messages?.length || 0) : `已导出: ${fileName} (${chat.messages?.length || 0} 条消息)`);

                try {
                    const finalTitle = chat.title || convId;
                    let chatTime = chat.timestamp ?? chat.updatedAt ?? null;
                    if (typeof chatTime === 'string') chatTime = new Date(chatTime).getTime();
                    const rec = {
                        title: finalTitle,
                        exportedAt: new Date().toISOString(),
                        messageCount: chat.messages?.length || 0,
                        chatTime: (typeof chatTime === 'number' && Number.isFinite(chatTime)) ? chatTime : null,
                        status: 'ok'
                    };
                    await getStorage().saveExportRecord(slot, convId, rec);
                    // SSOT: title write-back goes through the title-tier arbitration
                    // inside the conversation lock. The old shape raw-assigned
                    // item.title and blind-wrote the list outside the lock: it could
                    // clobber a concurrent tab's sync and let a lower-tier title
                    // overwrite a higher-tier one.
                    if (finalTitle !== convId && getStorage() && typeof getStorage().updateConversation === 'function') {
                        const tier = res && res.source === 'dom' ? 'dom' : 'rpc';
                        await getStorage().updateConversation(slot, convId, (current: any) => {
                            if (!current) return null;
                            const item = { ...current, titles: { ...(current.titles || {}) } };
                            const beforeTitle = item.title;
                            const beforeSource = item.titleSource;
                            GeminiUtils.setTitleBySource(item, tier, finalTitle);
                            if (item.title === beforeTitle && item.titleSource === beforeSource) return null;
                            return { title: item.title, titleSource: item.titleSource, titles: item.titles };
                        });
                    }
                } catch (e) {
                    console.warn('[GemExporter:storage] Storage operation failed:', e);
                }
                } finally {
                    __releaseExportGuard();
                }
            }).catch((err: any) => {
                __releaseExportGuard();
                log(typeof i18n !== 'undefined' ? i18n.t('popupFetchFailed', err?.message || String(err)) : ('抓取失败: ' + (err?.message || String(err))));
            });
        } catch (e: any) {
            __releaseExportGuard();
            log(typeof i18n !== 'undefined' ? i18n.t('popupExportError', e?.message) : ('导出异常: ' + e?.message));
            console.error('[popup] export current err', e);
        }
    });

    // Listen for sync updates
    chrome.runtime.onMessage.addListener((msg: any) => {
        const i18n = getI18n();
        if (msg.action === 'syncUpdate') {
            const badge = $('countBadge');
            if (badge) badge.textContent = typeof i18n !== 'undefined' ? i18n.t('syncedBadge', msg.count) : `${msg.count} synced`;
        }
        if (msg.action === 'exportProgress' || msg.action === 'scanProgress') {
            let pct = typeof msg.percent === 'number' ? msg.percent : (msg.total ? Math.floor((msg.done / msg.total) * 100) : 50);
            ProgressView.update(Math.min(Math.max(pct, 5), 100));
            if (msg.title) log(msg.title);
        }
    });


    // Init i18n and count
    const i18n = getI18n();
    if (typeof i18n !== 'undefined') {
        i18n.initLanguage().then(() => {
            i18n.applyI18n();
            i18n.applyLangToggleUI();
            i18n.onLanguageChange(() => i18n.applyLangToggleUI());
            updateCount();
        });
    } else {
        updateCount();
    }
    // Event-driven refresh: storage changes + explicit tab updates replace polling
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && (changes.gemini_conversations || changes.gemini_conversations_u0 || changes.gemini_last_count || changes.gemini_last_sync)) {
                updateCount();
            }
        });
    }
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.addListener(() => updateCount());
    }

export {};
