// src/ui/views/dialogView.js - Dialog and Banner Views
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DialogView = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function $(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    function renderExportBanner(session, currentSlot, isRunning) {
        const banner = $('exportSessionBanner');
        const bannerText = $('exportSessionText');
        const btnResume = $('btnResumeExport');
        if (!banner || !bannerText) return;

        if (isRunning || !session || !session.total) {
            banner.style.display = 'none';
            return;
        }

        const slot = currentSlot || 'u0';
        if (session.slot && session.slot !== slot) {
            banner.style.display = 'none';
            return;
        }

        const remaining = Math.max(0, session.total - (session.current || 0));

        if (session.status === 'running' || session.status === 'interrupted' || session.status === 'aborted') {
            if (remaining <= 0) {
                banner.style.display = 'none';
                return;
            }
            banner.style.display = 'flex';
            banner.style.borderColor = '#f59e0b';
            banner.style.background = '#221c12';
            let msg = typeof I18n !== 'undefined'
                ? I18n.t('exportSessionInterrupted', session.total, session.current || 0, remaining)
                : `⚠️ <b>发现未完成的导出任务</b>：共 ${session.total} 条，已处理 ${session.current || 0} 条，剩余 ${remaining} 条未导出。`;
            if (session.lastChatTitle) {
                msg += typeof I18n !== 'undefined'
                    ? I18n.t('exportSessionLastChat', session.lastChatTitle.slice(0, 20))
                    : ` (上次停在: 「${session.lastChatTitle.slice(0, 20)}」)`;
            }
            bannerText.innerHTML = msg;
            if (btnResume) btnResume.style.display = remaining > 0 ? '' : 'none';
        } else if (session.status === 'completed' || session.status === 'completed_with_errors') {
            const timeDiff = Date.now() - (session.updatedAt || 0);
            if (timeDiff < 300000) {
                banner.style.display = 'flex';
                banner.style.borderColor = session.failedCount > 0 ? '#f59e0b' : '#10b981';
                banner.style.background = session.failedCount > 0 ? '#221c12' : '#0e231b';
                let baseDone = typeof I18n !== 'undefined'
                    ? I18n.t('exportSessionCompleted', session.current || session.total)
                    : `✅ <b>上次导出已完成</b>：共导出 ${session.current || session.total} 条会话`;
                if (session.failedCount > 0) {
                    baseDone += typeof I18n !== 'undefined'
                        ? I18n.t('exportSessionCompletedWithErrors', session.failedCount)
                        : ` (其中 ${session.failedCount} 条失败)`;
                }
                bannerText.innerHTML = baseDone;
                if (btnResume) btnResume.style.display = 'none';
            } else {
                banner.style.display = 'none';
            }
        } else {
            banner.style.display = 'none';
        }
    }

    function dismissExportBanner() {
        const banner = $('exportSessionBanner');
        if (banner) banner.style.display = 'none';
        try {
            chrome.storage.local.remove(['gemini_last_export_session']);
        } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
    }

    function showDirectWritePrompt(count, onConfirmFolder, onContinueZip) {
        const modal = $('directWriteModal');
        const textEl = $('directWritePromptText');
        const btnFolder = $('btnModalSwitchFolder');
        const btnZip = $('btnModalContinueZip');
        const btnClose = $('btnDirectWriteClose');
        if (!modal) return;

        if (textEl && typeof I18n !== 'undefined' && I18n.t) {
            textEl.textContent = I18n.t('directWritePromptDesc', count);
        }

        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
            if (btnFolder) btnFolder.onclick = null;
            if (btnZip) btnZip.onclick = null;
            if (btnClose) btnClose.onclick = null;
        };

        const onKey = (e) => {
            if (e.key === 'Escape') {
                cleanup();
            }
        };
        if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

        if (btnClose) {
            btnClose.onclick = () => {
                cleanup();
            };
        }

        if (btnFolder) {
            btnFolder.onclick = () => {
                cleanup();
                if (onConfirmFolder) onConfirmFolder();
            };
        }

        if (btnZip) {
            btnZip.onclick = () => {
                cleanup();
                if (onContinueZip) onContinueZip();
            };
        }
    }

    function hideDirectWritePrompt() {
        const modal = $('directWriteModal');
        if (modal) modal.style.display = 'none';
    }

    async function showTakeoutLimitPrompt(options = {}) {
        const modal = $('takeoutLimitModal');
        const textEl = $('takeoutLimitPromptText');
        const btnImport = $('btnModalImportTakeout');
        const btnOpenWeb = $('btnModalOpenTakeoutWeb');
        const btnDismiss = $('btnModalDismissTakeout');
        const btnClose = $('btnTakeoutLimitClose');
        if (!modal) return;

        if (!options.force) {
            if (typeof StorageService !== 'undefined') {
                if (StorageService.isTakeoutPromptCompleted) {
                    try {
                        const isCompleted = await StorageService.isTakeoutPromptCompleted();
                        if (isCompleted) return;
                    } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
                }
                if (StorageService.hasTakeoutData) {
                    try {
                        const hasTakeout = await StorageService.hasTakeoutData();
                        if (hasTakeout) return;
                    } catch (e) { console.warn("[GemExporter:storage] Storage operation failed:", e); }
                }
            }
            if (typeof ConversationsStore !== 'undefined' && ConversationsStore.hasTakeoutData) {
                try {
                    if (ConversationsStore.hasTakeoutData()) return;
                } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:dialogView.js]", e); }
            }
        }

        const count = options.count || 600;
        const onImportTakeout = options.onImportTakeout;

        if (textEl && typeof I18n !== 'undefined' && I18n.t) {
            textEl.textContent = I18n.t('takeoutLimitPromptDesc', count);
        }
        if (btnOpenWeb && typeof I18n !== 'undefined' && I18n.t) {
            btnOpenWeb.textContent = I18n.t('btnModalOpenTakeoutWeb');
        }
        if (btnDismiss && typeof I18n !== 'undefined' && I18n.t) {
            btnDismiss.textContent = I18n.t('btnModalDismissTakeout');
        }

        modal.style.display = 'flex';

        const markCompleted = () => {
            if (typeof StorageService !== 'undefined' && StorageService.setTakeoutPromptCompleted) {
                StorageService.setTakeoutPromptCompleted(true);
            }
        };

        const cleanup = () => {
            modal.style.display = 'none';
            if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
            if (btnImport) btnImport.onclick = null;
            if (btnOpenWeb) btnOpenWeb.onclick = null;
            if (btnDismiss) btnDismiss.onclick = null;
            if (btnClose) btnClose.onclick = null;
            markCompleted();
        };

        const onKey = (e) => {
            if (e.key === 'Escape') {
                cleanup();
            }
        };
        if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

        if (btnClose) {
            btnClose.onclick = () => {
                cleanup();
            };
        }

        if (btnDismiss) {
            btnDismiss.onclick = () => {
                cleanup();
            };
        }

        if (btnOpenWeb) {
            btnOpenWeb.onclick = () => {
                markCompleted();
            };
        }

        if (btnImport) {
            btnImport.onclick = () => {
                cleanup();
                if (onImportTakeout) {
                    onImportTakeout();
                } else {
                    const input = $('takeoutFileInput');
                    if (input) input.click();
                }
            };
        }
    }

    function hideTakeoutLimitPrompt() {
        const modal = $('takeoutLimitModal');
        if (modal) modal.style.display = 'none';
    }

    return {
        renderExportBanner,
        dismissExportBanner,
        showDirectWritePrompt,
        hideDirectWritePrompt,
        showTakeoutLimitPrompt,
        hideTakeoutLimitPrompt
    };
}));
