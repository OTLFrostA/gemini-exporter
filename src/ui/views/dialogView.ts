import type { ExportSession, FailedChat, IDialogView } from '../../types/ui.js';
import { getSettings, updateSettings } from '../../core/application/index.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import ConversationsStore from '../state/conversationsStore.js';

import { $, t } from '../uiCommon.js';

const getStore = () => __resolveModule('ConversationsStore', ConversationsStore);

export function renderExportBanner(_session: ExportSession | null | undefined, _accountId: string, _running: boolean): void {
    const banner = $('exportSessionBanner');
    if (banner) banner.style.display = 'none';
}
export async function dismissExportBanner(): Promise<void> { renderExportBanner(null, '', false); }

function guidanceBusy(): boolean {
    return !!document.querySelector('.tour-overlay-container') || ['directWriteModal', 'takeoutLimitModal', 'takeoutImportModal']
        .some(id => { const element = $(id); return element && element.style.display === 'flex'; });
}

export function showDirectWritePrompt(count: number, onConfirmFolder: () => void, onContinueZip: () => void): void {
    const modal = $('directWriteModal');
    const textEl = $('directWritePromptText');
    const btnFolder = $('btnModalSwitchFolder');
    const btnZip = $('btnModalContinueZip');
    const btnClose = $('btnDirectWriteClose');
    if (!modal || guidanceBusy()) return;

    if (textEl && typeof t === 'function') {
        textEl.textContent = t('directWritePromptDesc', count);
    }

    modal.style.display = 'flex';

    const cleanup = () => {
        modal.style.display = 'none';
        if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
        if (btnFolder) btnFolder.onclick = null;
        if (btnZip) btnZip.onclick = null;
        if (btnClose) btnClose.onclick = null;
    };

    const onKey = (e: KeyboardEvent) => {
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

export function hideDirectWritePrompt(): void {
    const modal = $('directWriteModal');
    if (modal) modal.style.display = 'none';
}

export async function showTakeoutLimitPrompt(options: { count?: number; hitGoogleLimit?: boolean; force?: boolean; onImportTakeout?: () => void; onDismiss?: () => void } = {}): Promise<void> {
    const modal = $('takeoutLimitModal');
    const titleEl = $('takeoutLimitPromptTitle');
    const textEl = $('takeoutLimitPromptText');
    const btnImport = $('btnModalImportTakeout');
    const btnOpenWeb = $('btnModalOpenTakeoutWeb');
    const btnDismiss = $('btnModalDismissTakeout');
    const btnClose = $('btnTakeoutLimitClose');
    if (!modal || guidanceBusy()) return;

    if (!options.force && (await getSettings()).takeoutPromptCompleted) return;
    if (guidanceBusy()) return;

    const count = options.count ?? 600;
    const hitGoogleLimit = !!options.hitGoogleLimit;
    const onImportTakeout = options.onImportTakeout;

    if (titleEl && typeof t === 'function') {
        titleEl.textContent = hitGoogleLimit
            ? t('takeoutLimitPromptTitle')
            : t('takeoutBrowsingLimitTitle');
    }
    if (textEl && typeof t === 'function') {
        textEl.textContent = hitGoogleLimit
            ? t('takeoutLimitPromptDesc', count)
            : (t('takeoutBrowsingLimitDesc', count) || t('takeoutLimitPromptDesc', count));
    }
    if (btnOpenWeb && typeof t === 'function') {
        btnOpenWeb.textContent = t('btnModalOpenTakeoutWeb');
    }
    if (btnDismiss && typeof t === 'function') {
        btnDismiss.textContent = t('btnModalDismissTakeout');
    }

    modal.style.display = 'flex';

    const markCompleted = () => {
        if (typeof options.onDismiss === 'function') {
            try { options.onDismiss(); } catch {}
            return;
        }
        void updateSettings({ takeoutPromptCompleted: true });
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

    const onKey = (e: KeyboardEvent) => {
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

export function hideTakeoutLimitPrompt(): void {
    const modal = $('takeoutLimitModal');
    if (modal) modal.style.display = 'none';
}

let _lastFailedChats: FailedChat[] = [];

export function getLastFailedChats(): FailedChat[] {
    return _lastFailedChats;
}

export function setLastFailedChats(list: FailedChat[]): void {
    _lastFailedChats = Array.isArray(list) ? list : [];
}

export function renderExportFailureBanner(failedList: FailedChat[], onRetry?: () => void): void {
    _lastFailedChats = Array.isArray(failedList) ? failedList : [];
    const card = $('exportFailureCard');
    if (!card) return;
    if (!_lastFailedChats.length) {
        card.style.display = 'none';
        return;
    }
    const titleEl = $('exportFailureTitle');
    if (titleEl) {
        titleEl.textContent = typeof t === 'function' ? t('exportFailureBannerTitle') : '部分会话导出失败';
    }
    const btnRetry = $('btnRetryFailed');
    if (btnRetry) {
        btnRetry.textContent = typeof t === 'function' ? t('btnRetryFailedCount', _lastFailedChats.length) : `重试失败项 (${_lastFailedChats.length})`;
        if (onRetry) {
            btnRetry.onclick = () => onRetry();
        }
    }
    const btnCopy = $('btnCopyFailedLog');
    if (btnCopy) {
        btnCopy.textContent = typeof t === 'function' ? t('btnCopyFailedLog') : '复制错误';
        btnCopy.onclick = async () => {
            const textLines = _lastFailedChats.map(item => {
                const title = item.title || item.id || 'Untitled';
                const err = item.error || 'Unknown error';
                const cid = item.id || '';
                return `• [${cid}] ${title}: ${err}`;
            });
            const textToCopy = textLines.join('\n');
            try {
                if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(textToCopy);
                }
                const originalText = btnCopy.textContent;
                btnCopy.textContent = typeof t === 'function' ? t('failedLogCopied') : '已复制';
                setTimeout(() => {
                    if (btnCopy) btnCopy.textContent = originalText;
                }, 2000);
            } catch (err) {
                console.warn('[DialogView] Failed to copy failure log', err);
            }
        };
    }
    const btnDismiss = $('btnDismissFailure');
    if (btnDismiss) {
        btnDismiss.onclick = () => {
            card.style.display = 'none';
        };
    }
    const listEl = $('exportFailureList');
    if (listEl) {
        listEl.innerHTML = '';
        _lastFailedChats.slice(0, 50).forEach(item => {
            const row = document.createElement('div');
            row.style.whiteSpace = 'normal';
            row.style.wordBreak = 'break-word';
            row.style.padding = '3px 0';
            row.style.borderBottom = '1px dashed rgba(255, 255, 255, 0.08)';
            const itemTitle = item.title || item.id || 'Untitled';
            const itemErr = item.error ? ` (${item.error})` : '';
            row.textContent = `• ${itemTitle}${itemErr}`;
            row.title = `${item.id}: ${itemTitle}${itemErr}`;
            listEl.appendChild(row);
        });
        if (_lastFailedChats.length > 50) {
            const more = document.createElement('div');
            more.style.fontStyle = 'italic';
            more.style.padding = '4px 0';
            const extraCount = _lastFailedChats.length - 50;
            more.textContent = typeof t === 'function' ? t('failedChatsMore', extraCount) : `... 以及其他 ${extraCount} 项`;
            listEl.appendChild(more);
        }
    }
    card.style.display = 'block';
}

export function hideExportFailureBanner(): void {
    _lastFailedChats = [];
    const card = $('exportFailureCard');
    if (card) card.style.display = 'none';
}

export const DialogView: IDialogView = {
    renderExportBanner,
    dismissExportBanner,
    showDirectWritePrompt,
    hideDirectWritePrompt,
    showTakeoutLimitPrompt,
    hideTakeoutLimitPrompt,
    renderExportFailureBanner,
    hideExportFailureBanner,
    getLastFailedChats,
    setLastFailedChats
};



export default DialogView;
