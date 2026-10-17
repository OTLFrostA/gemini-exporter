import { cachedConversationAvailability } from '../../core/storage/conversationAvailability.js';
import { getAccounts } from '../state/conversationsStore.js';
import { conversationSourceUrl } from '../../core/utils/conversationSourceUrl.js';
import { indexActivityTime } from '../../core/domain/conversationIndex.js';
import type { DomainConversationIndex } from '../../types/conversation.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import { I18n as I18nStatic } from '../../core/utils/i18n.js';

import type { ExportRecord, IListView } from '../../types/ui.js';

import {
    isRealTitle as utilsIsRealTitle,
    cleanTitle as utilsCleanTitle,
    getEffectiveTimestamp as utilsGetEffectiveTimestamp,
    checkIsUpdated as utilsCheckIsUpdated,
    resolveConversationExportState as utilsResolveConversationExportState
} from '../../core/utils/utils.js';
import { $, t } from '../uiCommon.js';
import { normId } from '../../core/utils/pathUtils.js';

type ListUtilities = Partial<{
    isRealTitle: typeof utilsIsRealTitle;
    cleanTitle: typeof utilsCleanTitle;
    getEffectiveTimestamp: typeof utilsGetEffectiveTimestamp;
    checkIsUpdated: typeof utilsCheckIsUpdated;
    resolveConversationExportState: typeof utilsResolveConversationExportState;
}>;
const gu = (): ListUtilities => __resolveModule<ListUtilities>('GeminiUtils', {});

export const isRealTitle: typeof utilsIsRealTitle = (title, id) =>
    (gu().isRealTitle ?? utilsIsRealTitle)(title, id);

export const cleanTitle: typeof utilsCleanTitle = title =>
    (gu().cleanTitle ?? utilsCleanTitle)(title);

export const getEffectiveTimestamp: typeof utilsGetEffectiveTimestamp = chat =>
    (gu().getEffectiveTimestamp ?? utilsGetEffectiveTimestamp)(chat);

export const checkIsUpdated: typeof utilsCheckIsUpdated = (conversation, record) =>
    (gu().checkIsUpdated ?? utilsCheckIsUpdated)(conversation, record);

export const resolveConversationExportState: typeof utilsResolveConversationExportState = (conversation, record, options) => {
    const utilities = gu();
    if (utilities.resolveConversationExportState) {
        return utilities.resolveConversationExportState(conversation, record, options);
    }
    const customCheck = utilities.checkIsUpdated;
    return utilsResolveConversationExportState(conversation, record, {
        ...options,
        customHasNewerActivity: customCheck
            ? (conv, rec) => customCheck(conv, { ...rec, status: 'ok', hasFailedAssets: false })
            : undefined
    });
};

function escapeHtml(str?: string | null): string {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

let currentConversationsRef: readonly Readonly<DomainConversationIndex>[] = [];
let canonicalSelectedIds: Set<string> | null = null;
let currentFilterType: string = 'all';
let currentFailedChatIds: Set<string> | null = null;
let currentSearchFilter: string = '';

function ensureListDelegation(list: HTMLElement & { _delegated?: boolean }): void {
    if (!list || list._delegated) return;
    list._delegated = true;

    list.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('a.open-link')) {
            e.stopPropagation();
            return;
        }

        if (list.dataset?.selectionDisabled === 'true') return;

        if (target.matches('input[type=checkbox]')) {
            return;
        }

        const item = target.closest<HTMLElement>('.item');
        if (item) {
            const cb = item.querySelector<HTMLInputElement>('input[type=checkbox]');
            if (cb && !cb.disabled) {
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    list.addEventListener('change', (e: Event) => {
        if (list.dataset?.selectionDisabled === 'true') return;
        const target = e.target as HTMLElement;
        if (target.matches('input[type=checkbox]')) {
            const item = typeof target.closest === 'function' ? target.closest<HTMLElement>('.item') : null;
            const chatId = item?.dataset?.chatId;
            const cb = target as HTMLInputElement;
            if (chatId) {
                const nid = normId(chatId);
                if (!canonicalSelectedIds) canonicalSelectedIds = new Set<string>();
                if (cb.checked) {
                    canonicalSelectedIds.add(chatId);
                    canonicalSelectedIds.add(nid);
                } else {
                    canonicalSelectedIds.delete(chatId);
                    canonicalSelectedIds.delete(nid);
                    canonicalSelectedIds.delete('c_' + nid);
                }
            }
            updateStat(currentConversationsRef);
        }
    });
}

export function setSelectedIds(ids: Set<string> | null): void {
    canonicalSelectedIds = ids ? new Set(ids) : null;
}

export function render(
    conversations: readonly Readonly<DomainConversationIndex>[],
    exportedIds: Record<string, ExportRecord> = {},
    prevSelectedSet?: Set<string> | null,
    searchFilter: string = '',
    filterType: string = 'all',
    failedChatIds?: Set<string>
): void {
    const list = $('list') as (HTMLElement & { _delegated?: boolean }) | null;
    if (!list) return;
    currentConversationsRef = conversations || [];
    currentFilterType = filterType || 'all';
    currentFailedChatIds = failedChatIds || null;
    currentSearchFilter = searchFilter || '';
    ensureListDelegation(list);

    const expMap = exportedIds || {};

    if (prevSelectedSet instanceof Set) {
        canonicalSelectedIds = new Set(prevSelectedSet);
    } else if (prevSelectedSet === null || canonicalSelectedIds === null) {
        canonicalSelectedIds = new Set<string>();
        for (const c of currentConversationsRef) {
            const nid = normId(c.key.conversationId);
            const rec = expMap[nid] || null;
            const isFailedInSession = !!(
                failedChatIds && (failedChatIds.has(c.key.conversationId) || failedChatIds.has(nid) || failedChatIds.has('c_' + nid))
            );
            const st = resolveConversationExportState(c, rec, { isFailedInSession });
            if (st.shouldAutoSelect) {
                canonicalSelectedIds.add(c.key.conversationId);
                canonicalSelectedIds.add(nid);
            }
        }
    }

    if (!conversations || !conversations.length) {
        list.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center; font-size:12px;">${typeof t === 'function' ? t('emptyList') : 'No conversations found.'}</div>`;
        return;
    }
    const q = (searchFilter || '').trim().toLowerCase();

    const filtered = conversations.filter(c => {
        const nid = normId(c.key.conversationId);
        const rec = expMap[nid] || null;
        const isFailedInSession = !!(
            failedChatIds && (failedChatIds.has(c.key.conversationId) || failedChatIds.has(nid) || failedChatIds.has('c_' + nid))
        );
        const st = resolveConversationExportState(c, rec, { isFailedInSession });

        let matchesType = true;
        if (filterType === 'unexported') {
            matchesType = st.isUnexported;
        } else if (filterType === 'failed') {
            matchesType = st.isFailed;
        } else if (filterType === 'unexported_or_failed') {
            matchesType = st.isUnexported || st.isFailed;
        } else if (filterType === 'exported') {
            matchesType = st.isExportedClean;
        }

        if (!matchesType) return false;
        if (!q) return true;
        return (c.title ?? "").toLowerCase().includes(q) || c.key.conversationId.toLowerCase().includes(q);
    });

    if (!filtered.length) {
        list.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center; font-size:12px;">${typeof t === 'function' ? t('emptySearchList') : 'No matching conversations found.'}</div>`;
        return;
    }

    const htmlArr: string[] = [];
    const idxMap = new Map(conversations.map((c, idx) => [c, idx] as const));

    filtered.forEach((c) => {
        const origIdx = idxMap.get(c) ?? -1;
        const nid = normId(c.key.conversationId);
        const rec = expMap[nid] || null;
        const isFailedInSession = !!(
            failedChatIds && (failedChatIds.has(c.key.conversationId) || failedChatIds.has(nid) || failedChatIds.has('c_' + nid))
        );
        const st = resolveConversationExportState(c, rec, { isFailedInSession });
        let isChecked = false;
        if (canonicalSelectedIds) {
            isChecked = canonicalSelectedIds.has(c.key.conversationId) || canonicalSelectedIds.has(nid) || canonicalSelectedIds.has('c_' + nid);
        } else if (prevSelectedSet instanceof Set) {
            isChecked = prevSelectedSet.has(c.key.conversationId) || prevSelectedSet.has(nid) || prevSelectedSet.has('c_' + nid);
        } else {
            isChecked = st.shouldAutoSelect;
        }

        const displayTitle = escapeHtml(c.title || (t('untitledChat') || 'Untitled conversation'));
        const titleStyle = !c.title ? 'color:var(--warn); opacity:0.85;' : '';
        const ts = indexActivityTime(c);
        const dateStr = ts === undefined ? '' : new Date(ts).toLocaleDateString() + ' '
            + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let badgeHtml = '';
        if (st.badge && st.badge.kind !== 'none') {
            let expDateStr = '';
            if (rec && rec.exportedAt) {
                try {
                    const ed = typeof rec.exportedAt === 'string' ? new Date(rec.exportedAt) : new Date(Number(rec.exportedAt));
                    if (!isNaN(ed.getTime())) {
                        expDateStr = ed.toLocaleDateString();
                    }
                } catch {}
            }
            const b = st.badge;
            const badgeLabel = b.kind === 'updated'
                ? ((typeof t === 'function' && (t('badgeUpdated') || t('badgeNeedsReexport'))) || b.defaultLabel)
                : (typeof t === 'function' ? (t(b.i18nKey) || b.defaultLabel) : b.defaultLabel);
            badgeHtml = `<span class="${b.className}" style="font-size:10px; padding:2px 6px; border-radius:4px; background:${b.bg}; color:${b.color}; margin-left:8px; border:1px solid ${b.border};">${badgeLabel}${expDateStr ? ` (${expDateStr})` : ''}</span>`;
        }

        const availability = cachedConversationAvailability(c.key.accountId)[c.key.conversationId];
        const cloudLabel = availability === 'deleted' ? t('archiveCloudDeleted') : availability === 'unlisted' ? t('archiveUnlisted') : '';
        const cloudBadge = cloudLabel ? `<span class="cloud-status" style="font-size:10px; color:var(--muted); margin-left:8px;">${escapeHtml(cloudLabel)}</span>` : '';
        const rawUrl = conversationSourceUrl(getAccounts().find(account => account.id === c.key.accountId)?.providerId ?? "gemini", c.key.conversationId);
        const url = (typeof rawUrl === 'string' && /^https?:\/\//i.test(rawUrl.trim()))
            ? rawUrl.trim()
            : `https://gemini.google.com/app/${encodeURIComponent(c.key.conversationId)}`;

        htmlArr.push(`
            <div class="item" data-chat-id="${escapeHtml(c.key.conversationId)}" style="display:flex; align-items:center; padding:8px 12px; border-bottom:1px solid var(--border); font-size:13px; cursor:pointer; user-select:none;">
                <input type="checkbox" data-idx="${origIdx}" ${isChecked ? 'checked' : ''} ${list.dataset?.selectionDisabled === 'true' ? 'disabled' : ''} style="margin-right:10px; cursor:pointer;" />
                <div style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    <span class="chat-title" style="${titleStyle}">${displayTitle}</span>
                    ${badgeHtml}${cloudBadge}
                </div>
                <span style="font-size:11px; color:var(--muted); margin-left:12px; white-space:nowrap;">${escapeHtml(dateStr)}</span>
                <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="open-link" style="color:var(--muted); margin-left:10px; text-decoration:none; font-size:12px;" title="${escapeHtml(typeof t === 'function' ? t('openInGemini') : 'Open in Gemini')}">↗</a>
            </div>
        `);
    });

    list.innerHTML = htmlArr.join('');
}

export function updateItemExportStatus(chatId: string, exportRecord?: Partial<ExportRecord> | null): void {
    if (!chatId) return;
    const nid = normId(chatId);
    const esc = (v: string): string =>
        (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
    const list = typeof document !== 'undefined'
        ? ((typeof document.getElementById === 'function' ? document.getElementById('list') : null) || document)
        : null;
    if (!list || !list.querySelector) return;
    const item = list.querySelector(`[data-chat-id="${esc(nid)}"], [data-chat-id="${esc(chatId)}"], [data-chat-id="${esc('c_' + nid)}"]`);
    if (!item) return;

    const st = resolveConversationExportState({}, exportRecord || { status: 'ok' });
    const b = st.badge.kind !== 'none' ? st.badge : resolveConversationExportState({}, { status: 'ok' }).badge;
    const _i18n = __resolveModule('I18n', I18nStatic);
    const bText = (_i18n.t)
        ? _i18n.t(b.i18nKey)
        : (typeof t === 'function' ? t(b.i18nKey) : b.defaultLabel);
    const badgeText = (bText && bText !== b.i18nKey) ? bText : b.defaultLabel;

    let badge = item.querySelector ? item.querySelector<HTMLElement>('.badge') : null;
    if (badge) {
        badge.className = b.className;
        badge.textContent = badgeText;
        if (badge.style) {
            badge.style.background = b.bg;
            badge.style.borderColor = b.border;
            badge.style.color = b.color;
        }
    } else {
        const titleContainer = item.querySelector ? item.querySelector('div') : null;
        if (titleContainer && document.createElement) {
            const span = document.createElement('span');
            span.className = b.className;
            span.style.cssText = `font-size:10px; padding:2px 6px; border-radius:4px; background:${b.bg}; color:${b.color}; margin-left:8px; border:1px solid ${b.border};`;
            span.textContent = badgeText;
            titleContainer.appendChild(span);
        }
    }
}

export function updateStat(conversations?: readonly Readonly<DomainConversationIndex>[]): void {
    const list = $('list');
    if (!list) return;
    const convs = conversations || currentConversationsRef || [];
    const total = convs.length;
    let checked = 0;
    if (canonicalSelectedIds && canonicalSelectedIds.size > 0 && convs.length > 0) {
        checked = convs.filter(c => {
            const nid = normId(c.key.conversationId);
            return canonicalSelectedIds!.has(c.key.conversationId) || canonicalSelectedIds!.has(nid) || canonicalSelectedIds!.has('c_' + nid);
        }).length;
    } else {
        checked = document.querySelectorAll<HTMLInputElement>('#list input[type=checkbox]:checked').length;
    }
    const statEl = $('selectedStat');
    if (statEl) {
        statEl.textContent = typeof t === 'function' ? t('selectedStat', checked, total) : `${checked} of ${total} selected`;
    }
}

export function getSelected(conversations?: readonly Readonly<DomainConversationIndex>[]): Readonly<DomainConversationIndex>[] {
    const convs = conversations || currentConversationsRef || [];
    if (canonicalSelectedIds && canonicalSelectedIds.size > 0) {
        const selected = convs.filter(c => {
            const nid = normId(c.key.conversationId);
            return canonicalSelectedIds!.has(c.key.conversationId) || canonicalSelectedIds!.has(nid) || canonicalSelectedIds!.has('c_' + nid);
        });
        if (selected.length > 0) return selected;
    }
    const selected: Readonly<DomainConversationIndex>[] = [];
    document.querySelectorAll<HTMLInputElement>('#list input[type=checkbox]:checked').forEach((cb) => {
        const item = typeof cb.closest === 'function' ? cb.closest<HTMLElement>('.item') : null;
        const chatId = item?.dataset?.chatId;
        if (chatId) {
            const found = convs.find(c => normId(c.key.conversationId) === normId(chatId));
            if (found) {
                selected.push(found);
                return;
            }
        }
        const idx = parseInt(cb.dataset?.idx || '-1', 10);
        if (idx >= 0 && convs[idx]) {
            selected.push(convs[idx]);
        }
    });
    return selected;
}

export function getSelectedIds(): Set<string> {
    if (canonicalSelectedIds && canonicalSelectedIds.size > 0) {
        return new Set(canonicalSelectedIds);
    }
    const ids = new Set<string>();
    document.querySelectorAll<HTMLInputElement>('#list input[type=checkbox]:checked').forEach((cb) => {
        const item = typeof cb.closest === 'function' ? cb.closest<HTMLElement>('.item') : null;
        const chatId = item?.dataset?.chatId;
        if (chatId) ids.add(chatId);
    });
    return ids;
}

export function selectAll(conversations?: readonly Readonly<DomainConversationIndex>[]): void {
    if (!canonicalSelectedIds) canonicalSelectedIds = new Set<string>();
    document.querySelectorAll<HTMLInputElement>('#list input[type=checkbox]').forEach((cb) => {
        cb.checked = true;
        const item = typeof cb.closest === 'function' ? cb.closest<HTMLElement>('.item') : null;
        const chatId = item?.dataset?.chatId;
        if (chatId) {
            canonicalSelectedIds!.add(chatId);
            canonicalSelectedIds!.add(normId(chatId));
        } else {
            const idx = parseInt(cb.dataset?.idx || '-1', 10);
            const convs = conversations || currentConversationsRef || [];
            if (idx >= 0 && convs[idx]) {
                canonicalSelectedIds!.add(convs[idx].key.conversationId);
                canonicalSelectedIds!.add(normId(convs[idx].key.conversationId));
            }
        }
    });
    updateStat(conversations);
}

export function deselectAll(conversations?: readonly Readonly<DomainConversationIndex>[]): void {
    if (!canonicalSelectedIds) canonicalSelectedIds = new Set<string>();
    document.querySelectorAll<HTMLInputElement>('#list input[type=checkbox]').forEach((cb) => {
        cb.checked = false;
        const item = typeof cb.closest === 'function' ? cb.closest<HTMLElement>('.item') : null;
        const chatId = item?.dataset?.chatId;
        if (chatId) {
            const nid = normId(chatId);
            canonicalSelectedIds!.delete(chatId);
            canonicalSelectedIds!.delete(nid);
            canonicalSelectedIds!.delete('c_' + nid);
        } else {
            const idx = parseInt(cb.dataset?.idx || '-1', 10);
            const convs = conversations || currentConversationsRef || [];
            if (idx >= 0 && convs[idx]) {
                const nid = normId(convs[idx].key.conversationId);
                canonicalSelectedIds!.delete(convs[idx].key.conversationId);
                canonicalSelectedIds!.delete(nid);
                canonicalSelectedIds!.delete('c_' + nid);
            }
        }
    });
    updateStat(conversations);
}

export function selectUnexported(conversations?: readonly Readonly<DomainConversationIndex>[], exportedIds?: Record<string, ExportRecord>): void {
    const convList = conversations || currentConversationsRef || [];
    const expMap = exportedIds || {};
    if (!canonicalSelectedIds) canonicalSelectedIds = new Set<string>();
    document.querySelectorAll<HTMLInputElement>('#list input[type=checkbox]').forEach((cb) => {
        const idx = parseInt(cb.dataset?.idx || '-1', 10);
        const c = convList[idx];
        if (!c) {
            cb.checked = false;
            return;
        }
        const nid = normId(c.key.conversationId);
        const rec = expMap[nid] || null;
        const check = !rec;
        cb.checked = check;
        if (check) {
            canonicalSelectedIds!.add(c.key.conversationId);
            canonicalSelectedIds!.add(nid);
        } else {
            canonicalSelectedIds!.delete(c.key.conversationId);
            canonicalSelectedIds!.delete(nid);
            canonicalSelectedIds!.delete('c_' + nid);
        }
    });
    updateStat(conversations);
}

export function selectByIds(targetIds: Set<string> | string[], conversations?: readonly Readonly<DomainConversationIndex>[]): void {
    const idSet = new Set(Array.from(targetIds).map(id => normId(id)));
    canonicalSelectedIds = new Set(idSet);
    document.querySelectorAll<HTMLInputElement>('#list input[type=checkbox]').forEach((cb) => {
        const item = typeof cb.closest === 'function' ? cb.closest<HTMLElement>('.item') : null;
        const chatId = normId(item?.dataset?.chatId);
        cb.checked = !!chatId && idSet.has(chatId);
    });
    updateStat(conversations || currentConversationsRef);
}

export const ListView: IListView = {
    render,
    updateStat,
    getSelected,
    getSelectedIds,
    selectAll,
    deselectAll,
    selectUnexported,
    selectByIds,
    setSelectedIds,
    isRealTitle,
    updateItemExportStatus,
    checkIsUpdated,
    resolveConversationExportState
};


export default ListView;
