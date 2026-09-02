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
        } catch {}
    }

    return {
        renderExportBanner,
        dismissExportBanner
    };
}));
