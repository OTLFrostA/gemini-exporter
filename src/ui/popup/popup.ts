// src/ui/popup/popup.ts - Enhanced Action Center Popup for Gemini Exporter

import { GeminiUtils, cleanTitle } from '../../core/utils/utils.js';
import { StorageService } from '../../core/storage/storageService.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import { FormatStore } from '../../core/storage/formatStore.js';
import { ChatFormatter } from '../../core/engine/chatFormatter.js';
import { ScreenshotStitcher, type CapturedFrame } from '../../core/engine/screenshotStitcher.js';
import { canvasToPdfBlob } from '../../core/engine/pdfWrapper.js';
import {
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName
} from '../../core/utils/pathUtils.js';
import { $, getI18n } from '../uiCommon.js';
import { sendTypedMessage } from '../../core/utils/messaging.js';
import { ProgressView } from '../views/progressView.js';
import { STORAGE_KEYS } from '../../core/utils/constants.js';

const getStorage = () => __resolveModule('StorageService', StorageService);

let _activeTab: chrome.tabs.Tab | null = null;
let _activeConvId: string | null = null;
let _activeSlot: string = 'u0';
let _activeChatTitle: string = '';
let _currentScreenshotBlob: Blob | null = null;
let _currentScreenshotCanvas: HTMLCanvasElement | null = null;
let _isCapturingScreenshot = false;
let _isExportingCurrentPage = false;
let _activeFormat = 'markdown';

function updateFormatTabsUI(targetFormat: string, isDev?: boolean): void {
    _activeFormat = targetFormat || 'markdown';
    const tabBtns = document.querySelectorAll('#formatTabs .tab-btn') as NodeListOf<HTMLButtonElement>;
    tabBtns.forEach(btn => {
        const val = btn.getAttribute('data-value');
        if (val === _activeFormat) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        if (val === 'json_raw') {
            btn.style.display = isDev ? '' : 'none';
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
    const btnScreenshot = $('btnScreenshot') as HTMLButtonElement | null;
    const btnCopyMarkdown = $('btnCopyMarkdown') as HTMLButtonElement | null;
    const btnCurrent = $('btnCurrent') as HTMLButtonElement | null;
    const notGeminiNotice = $('notGeminiNotice');
    const currentChatContent = $('currentChatContent');
    const countBadge = $('countBadge');
    const i18n = getI18n();

    if (!isGemini) {
        const notGeminiTip = typeof i18n !== 'undefined' ? i18n.t('popupNotGemini') : '当前页不是 gemini.google.com';
        if (btnScreenshot) {
            btnScreenshot.disabled = true;
            btnScreenshot.title = notGeminiTip;
        }
        if (btnCopyMarkdown) {
            btnCopyMarkdown.disabled = true;
            btnCopyMarkdown.title = notGeminiTip;
        }
        if (btnCurrent) {
            btnCurrent.disabled = true;
            btnCurrent.title = notGeminiTip;
        }
        if (notGeminiNotice) notGeminiNotice.style.display = '';
        if (currentChatContent) currentChatContent.style.display = 'none';
        if (countBadge) countBadge.classList.add('inactive');
    } else {
        if (btnScreenshot) {
            btnScreenshot.disabled = false;
            btnScreenshot.title = '';
        }
        if (btnCopyMarkdown) {
            btnCopyMarkdown.disabled = false;
            btnCopyMarkdown.title = '';
        }
        if (btnCurrent) {
            btnCurrent.disabled = false;
            btnCurrent.title = '';
        }
        if (notGeminiNotice) notGeminiNotice.style.display = 'none';
        if (currentChatContent) currentChatContent.style.display = '';
        if (countBadge) countBadge.classList.remove('inactive');
    }
}

// Update synced count badge and tab UI state
async function updateCount(): Promise<void> {
    try {
        let slot = 'u0';
        let isGemini = false;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        _activeTab = tab || null;

        if (tab?.url && isGeminiUrl(tab.url)) {
            isGemini = true;
            slot = detectSlotFromUrl(tab.url);
            _activeSlot = slot;
            _activeConvId = extractConversationIdFromUrl(tab.url);
        } else {
            _activeConvId = null;
        }
        updateUiForTabState(isGemini);

        // Update active chat info card
        const currentChatTitleEl = $('currentChatTitle');
        const chatSlotBadgeEl = $('chatSlotBadge');
        const chatTurnBadgeEl = $('chatTurnBadge');
        const i18n = getI18n();

        if (chatSlotBadgeEl) chatSlotBadgeEl.textContent = slot.toUpperCase();

        if (isGemini && _activeConvId) {
            const list = getStorage() ? await getStorage().getConversations(slot) : [];
            const found = list.find((c: any) => c.id === _activeConvId || c.id === `c_${_activeConvId}`);
            if (found && found.title) {
                _activeChatTitle = cleanTitle(found.title);
            } else if (tab?.title) {
                _activeChatTitle = cleanTitle(tab.title.replace(/ - Gemini$/, ''));
            } else {
                _activeChatTitle = _activeConvId;
            }

            if (currentChatTitleEl) {
                currentChatTitleEl.textContent = _activeChatTitle;
                currentChatTitleEl.title = _activeChatTitle;
            }

            const msgCount = found?.messageCount || found?.messages?.length || 0;
            if (chatTurnBadgeEl) {
                chatTurnBadgeEl.textContent = msgCount > 0
                    ? (typeof i18n !== 'undefined' ? i18n.t('chatMessagesCount', msgCount) : `${msgCount} turns`)
                    : (typeof i18n !== 'undefined' ? i18n.t('chatNoMessages') : 'New chat');
            }
        } else if (isGemini) {
            if (currentChatTitleEl) {
                currentChatTitleEl.textContent = typeof i18n !== 'undefined' ? i18n.t('chatNoMessages') : 'New chat';
            }
            if (chatTurnBadgeEl) {
                chatTurnBadgeEl.textContent = typeof i18n !== 'undefined' ? i18n.t('chatNoMessages') : 'New chat';
            }
        }

        // Global count badge
        let count = 0;
        const convs = await getStorage().getConversations(slot);
        count = convs.length;
        if (!count) {
            const syncInfo = await getStorage().getLastSync(slot);
            count = syncInfo?.count || 0;
        }
        const badge = $('countBadge');
        if (badge) {
            const text = typeof i18n !== 'undefined' ? i18n.t('syncedBadge', count) : `${count} synced`;
            const label = slot === 'u0' ? text : `${text} (${slot.toUpperCase()})`;
            const offlineLabel = (typeof i18n !== 'undefined' && typeof i18n.t === 'function') ? i18n.t('badgeOffline') : 'offline';
            badge.textContent = isGemini ? label : `${label} (${offlineLabel})`;
        }
        const historyCountBadge = $('historyCountBadge');
        if (historyCountBadge) {
            historyCountBadge.textContent = `${count} chats`;
        }
    } catch (e) {
        console.warn('[popup] updateCount err', e);
    }
}

const handleLangChange = async (targetLang: string): Promise<void> => {
    const i18n = getI18n();
    if (i18n && typeof i18n.setLang === 'function') {
        await i18n.setLang(targetLang);
        if (typeof document !== 'undefined') {
            document.documentElement.lang = targetLang === 'zh' ? 'zh-CN' : 'en';
        }
        if (typeof i18n.applyI18n === 'function') i18n.applyI18n();
        if (typeof i18n.applyLangToggleUI === 'function') i18n.applyLangToggleUI();
        const isDev = (typeof document !== 'undefined' && document.body.classList.contains('dev-mode'));
        updateFormatTabsUI(_activeFormat, isDev);
        await updateCount();
    }
};

// ==================== Long Screenshot Workflow ====================
async function handleLongScreenshot(): Promise<void> {
    const i18n = getI18n();
    const btnScreenshot = $('btnScreenshot') as HTMLButtonElement | null;

    if (_isCapturingScreenshot) {
        log(typeof i18n !== 'undefined' ? i18n.t('popupExportBusy') : '正在截图中，请稍候…');
        return;
    }
    if (!_activeTab || !_activeTab.id) {
        log(typeof i18n !== 'undefined' ? i18n.t('popupNotGemini') : '未找到活动 Gemini 标签页');
        return;
    }

    _isCapturingScreenshot = true;
    if (btnScreenshot) btnScreenshot.disabled = true;
    ProgressView.show(5);
    log(typeof i18n !== 'undefined' ? i18n.t('screenshotStitching') : '正在平滑滚动并拼接长图...');

    try {
        // 1. Prepare tab (hide overlays, get heights)
        const prepRes = await chrome.tabs.sendMessage(_activeTab.id, { action: 'screenshotPrepare' });
        if (!prepRes || !prepRes.ok) {
            throw new Error(prepRes?.error || '无法初始化页面截图视口');
        }

        const { totalHeight, viewportHeight, viewportWidth, devicePixelRatio, originalScrollTop } = prepRes;
        const stepSize = Math.max(100, Math.floor(viewportHeight * 0.82));
        const totalSteps = Math.min(18, Math.max(1, Math.ceil((totalHeight - viewportHeight) / stepSize) + 1));
        const frames: CapturedFrame[] = [];

        // 2. Step through the document, scroll & capture
        for (let i = 0; i < totalSteps; i++) {
            const targetY = Math.min(i * stepSize, Math.max(0, totalHeight - viewportHeight));
            await chrome.tabs.sendMessage(_activeTab.id, { action: 'screenshotScroll', targetY });

            // Small delay to allow complete visual rendering & avoid capture limits
            await new Promise((r) => setTimeout(r, 220));

            // Capture visible tab via background or runtime API
            const captureRes = await new Promise<{ ok: boolean; dataUrl?: string; error?: string }>((resolve) => {
                chrome.runtime.sendMessage({ action: 'captureTab' }, (res) => {
                    if (res && res.ok && res.dataUrl) {
                        resolve(res);
                    } else {
                        // Fallback directly to tabs.captureVisibleTab
                        chrome.tabs.captureVisibleTab(null as any, { format: 'png' }, (dataUrl) => {
                            if (chrome.runtime.lastError || !dataUrl) {
                                resolve({ ok: false, error: chrome.runtime.lastError?.message || 'Capture failed' });
                            } else {
                                resolve({ ok: true, dataUrl });
                            }
                        });
                    }
                });
            });

            if (!captureRes.ok || !captureRes.dataUrl) {
                console.warn(`[popup] Step ${i} capture failed: ${captureRes.error}`);
            } else {
                frames.push({
                    dataUrl: captureRes.dataUrl,
                    scrollTop: targetY,
                    viewportHeight,
                    viewportWidth
                });
            }

            const pct = Math.round(10 + ((i + 1) / totalSteps) * 70);
            ProgressView.update(pct);
        }

        // 3. Restore page elements
        await chrome.tabs.sendMessage(_activeTab.id, { action: 'screenshotRestore', originalScrollTop });

        if (!frames.length) {
            throw new Error('未成功捕获任何视口切片');
        }

        // 4. Stitch in Canvas
        ProgressView.update(88);
        const stitched = await ScreenshotStitcher.stitchFrames({
            frames,
            totalHeight,
            viewportWidth,
            viewportHeight,
            devicePixelRatio: devicePixelRatio || 1
        });

        _currentScreenshotBlob = stitched.blob;
        _currentScreenshotCanvas = stitched.canvas;

        // 5. Present in Lightbox
        const previewModal = $('previewModal');
        const previewImage = $('previewImage') as HTMLImageElement | null;
        if (previewImage) previewImage.src = stitched.dataUrl;
        if (previewModal) previewModal.classList.add('active');

        ProgressView.complete();
        log(typeof i18n !== 'undefined' ? i18n.t('screenshotReady') : '长截图生成就绪');
    } catch (e: any) {
        log(`截图失败: ${e?.message || e}`);
        ProgressView.hide();
    } finally {
        _isCapturingScreenshot = false;
        if (btnScreenshot) btnScreenshot.disabled = false;
    }
}

// ==================== Copy Markdown Workflow ====================
async function handleCopyMarkdown(): Promise<void> {
    const i18n = getI18n();
    if (!_activeConvId) {
        log(typeof i18n !== 'undefined' ? i18n.t('popupNoChatId') : '当前页未打开具体对话');
        return;
    }

    log(typeof i18n !== 'undefined' ? i18n.t('popupExporting') : '正在抓取内容…');
    ProgressView.show(30);

    try {
        const res = await sendTypedMessage({ action: 'fetchChat', conversationId: _activeConvId, accountSlot: _activeSlot }, 30000);
        if (!res || !res.success) {
            throw new Error(res?.error || '抓取对话失败');
        }
        ProgressView.update(70);
        const chat = res.data || res;
        const markdown = ChatFormatter.toMarkdown(chat);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(markdown);
            ProgressView.complete();
            log(typeof i18n !== 'undefined' ? i18n.t('markdownCopied') : 'Markdown 已复制到剪贴板！');
        } else {
            throw new Error('浏览器剪贴板 API 不可用');
        }
    } catch (e: any) {
        log(`复制 Markdown 异常: ${e?.message || e}`);
        ProgressView.hide();
    }
}

// ==================== Initialization ====================
function initPopupEvents(): void {
    const langToggle = $('langToggle') as HTMLInputElement | null;
    langToggle?.addEventListener('change', (e: Event) => {
        handleLangChange((e.target as HTMLInputElement).checked ? 'en' : 'zh');
    });

    $('labelLangZh')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (langToggle) langToggle.checked = false;
        handleLangChange('zh');
    });

    $('labelLangEn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (langToggle) langToggle.checked = true;
        handleLangChange('en');
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
        handleLangChange(nextLang);
    });

    // Formats & Segmented Tabs
    const formatStore = __resolveModule('FormatStore', FormatStore);
    const formatSelect = $('format') as HTMLSelectElement | null;
    if (formatStore && formatStore.loadFormat) {
        formatStore.loadFormat(formatSelect).then(({ format, isDev }: { format: string; isDev: boolean }) => {
            if (isDev && typeof document !== 'undefined') document.body.classList.add('dev-mode');
            updateFormatTabsUI(format, isDev);
        });
    }

    const tabBtns = document.querySelectorAll('#formatTabs .tab-btn') as NodeListOf<HTMLButtonElement>;
    tabBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const val = btn.getAttribute('data-value');
            if (val) {
                const fStore = __resolveModule('FormatStore', FormatStore);
                if (fStore && typeof fStore.saveFormat === 'function') {
                    await fStore.saveFormat(val);
                }
                const isDev = (typeof document !== 'undefined' && document.body.classList.contains('dev-mode'));
                updateFormatTabsUI(val, isDev);
            }
        });
    });

    formatSelect?.addEventListener('change', (e: Event) => {
        const val = (e.target as HTMLSelectElement).value;
        const fStore = __resolveModule('FormatStore', FormatStore);
        if (fStore && typeof fStore.saveFormat === 'function') {
            fStore.saveFormat(val);
        }
        const isDev = (typeof document !== 'undefined' && document.body.classList.contains('dev-mode'));
        updateFormatTabsUI(val, isDev);
    });

    // Workbench links
    $('btnOptions')?.addEventListener('click', () => chrome.runtime.openOptionsPage());

    // Screenshot actions
    $('btnScreenshot')?.addEventListener('click', () => handleLongScreenshot());
    $('btnCopyMarkdown')?.addEventListener('click', () => handleCopyMarkdown());

    // Preview Lightbox Buttons
    $('btnClosePreview')?.addEventListener('click', () => {
        $('previewModal')?.classList.remove('active');
    });

    $('btnCopyImage')?.addEventListener('click', async () => {
        const i18n = getI18n();
        if (!_currentScreenshotBlob) return;
        try {
            if (navigator.clipboard && typeof (window as any).ClipboardItem !== 'undefined') {
                const item = new (window as any).ClipboardItem({ 'image/png': _currentScreenshotBlob });
                await navigator.clipboard.write([item]);
                log(typeof i18n !== 'undefined' ? i18n.t('screenshotCopied') : '长图已复制到剪贴板！');
            } else {
                throw new Error('ClipboardItem API not supported');
            }
        } catch (err: any) {
            log(typeof i18n !== 'undefined' ? i18n.t('screenshotCopyFailed') : '复制失败，请点击保存 PNG');
        }
    });

    $('btnSaveImage')?.addEventListener('click', () => {
        const i18n = getI18n();
        if (!_currentScreenshotBlob) return;
        const name = (_activeChatTitle || 'gemini_screenshot').replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `${name}_long.png`;
        const url = URL.createObjectURL(_currentScreenshotBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        log(typeof i18n !== 'undefined' ? i18n.t('screenshotSaved') : `已保存为 ${fileName}`);
    });

    $('btnSavePdf')?.addEventListener('click', async () => {
        const i18n = getI18n();
        if (!_currentScreenshotCanvas) return;
        try {
            const pdfBlob = await canvasToPdfBlob(_currentScreenshotCanvas);
            const name = (_activeChatTitle || 'gemini_screenshot').replace(/[\\/:*?"<>|]/g, '_');
            const fileName = `${name}.pdf`;
            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 3000);
            log(typeof i18n !== 'undefined' ? i18n.t('screenshotPdfSaved') : `已保存为 ${fileName}`);
        } catch (e: any) {
            log(`PDF 导出失败: ${e?.message || e}`);
        }
    });

    // "只导当前页" (File Download)
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
        let format: string = _activeFormat || currentFormatSelect?.value || 'markdown';
        ProgressView.show(10);

        try {
            if (!_activeConvId) {
                log(typeof i18n !== 'undefined' ? i18n.t('popupNoChatId') : '当前页未打开具体对话');
                __releaseExportGuard();
                return;
            }
            sendTypedMessage({ action: 'fetchChat', conversationId: _activeConvId, accountSlot: _activeSlot }, 40000).then(async (res: any) => {
                try {
                    if (!res || !res.success) {
                        log(typeof i18n !== 'undefined' ? i18n.t('popupFetchFailed', res?.error || '未知错误') : ('抓取失败: ' + (res?.error || '未知错误')));
                        return;
                    }

                    ProgressView.update(80);
                    const chat = res.data || res;
                    if (!chat.id) chat.id = _activeConvId;
                    chat.title = cleanTitle(chat.title || _activeChatTitle);

                    const formatted = ChatFormatter.formatContent(chat, format);
                    const fileName = buildExportFileName(chat.title || chat.id, _activeConvId, formatted.ext);
                    const blob = new Blob([formatted.content], { type: formatted.mime });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 3000);

                    ProgressView.complete();
                    log(typeof i18n !== 'undefined' ? i18n.t('popupExported', fileName, chat.messages?.length || 0) : `已导出: ${fileName}`);
                } finally {
                    __releaseExportGuard();
                }
            }).catch((err: any) => {
                __releaseExportGuard();
                log(typeof i18n !== 'undefined' ? i18n.t('popupFetchFailed', err?.message || String(err)) : ('抓取失败: ' + (err?.message || String(err))));
            });
        } catch (e: any) {
            __releaseExportGuard();
            log(typeof i18n !== 'undefined' ? i18n.t('popupExportError', e?.message) : `导出异常: ${e?.message}`);
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

    // Init i18n
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

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local') {
                if (changes[STORAGE_KEYS.LANG]) {
                    const newLang = String(changes[STORAGE_KEYS.LANG].newValue || 'zh');
                    const i18nInst = getI18n();
                    if (i18nInst && typeof i18nInst.getLang === 'function' && i18nInst.getLang() !== newLang) {
                        handleLangChange(newLang);
                    }
                }
                if (changes[STORAGE_KEYS.FORMAT]) {
                    const newFmt = String(changes[STORAGE_KEYS.FORMAT].newValue || 'markdown');
                    const isDev = (typeof document !== 'undefined' && document.body.classList.contains('dev-mode'));
                    updateFormatTabsUI(newFmt, isDev);
                }
                if (changes[STORAGE_KEYS.DEV_MODE]) {
                    const isDev = !!changes[STORAGE_KEYS.DEV_MODE].newValue;
                    if (typeof document !== 'undefined') {
                        if (isDev) document.body.classList.add('dev-mode');
                        else document.body.classList.remove('dev-mode');
                    }
                    updateFormatTabsUI(_activeFormat, isDev);
                }
                if (changes.gemini_conversations || changes.gemini_last_count || changes.gemini_last_sync) {
                    updateCount();
                }
            }
        });
    }
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.addListener(() => updateCount());
    }
}

initPopupEvents();

export {};
