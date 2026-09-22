// src/ui/views/listView.ts - List rendering, no storage
import type { Conversation } from '../../types/conversation.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import { I18n as I18nStatic } from '../../core/utils/i18n.js';

const gu = (): any => __resolveModule('GeminiUtils', null);
import type { ExportRecord, IListView } from '../../types/ui.js';

import {
    isRealTitle as utilsIsRealTitle,
    cleanTitle as utilsCleanTitle,
    resolveTitle as utilsResolveTitle,
    getEffectiveTimestamp as utilsGetEffectiveTimestamp,
    checkIsUpdated as utilsCheckIsUpdated
} from '../../core/utils/utils.js';
import { $, t } from '../uiCommon.js';
import { normId } from '../../core/utils/pathUtils.js';

export const isRealTitle = (title?: string | null, id?: string | null): boolean =>
    gu()?.isRealTitle ? gu().isRealTitle(title, id) : utilsIsRealTitle(title, id || undefined);

export const cleanTitle = (tStr?: string | null): string =>
    gu()?.cleanTitle ? gu().cleanTitle(tStr) : utilsCleanTitle(tStr);

export const resolveTitle = (chat: any): { title: string; source: string } =>
    gu()?.resolveTitle ? gu().resolveTitle(chat) : utilsResolveTitle(chat);

export const getEffectiveTimestamp = (chat?: any): number =>
    gu()?.getEffectiveTimestamp ? gu().getEffectiveTimestamp(chat) : utilsGetEffectiveTimestamp(chat);

export function checkIsUpdated(c: any, rec?: ExportRecord | null): boolean {
    return gu()?.checkIsUpdated
        ? gu().checkIsUpdated(c, rec)
        : utilsCheckIsUpdated(c, rec);
}

function escapeHtml(str?: string | null): string {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function setOnDelete(_cb: (chatId: string) => void): void {
    // Preserved for IListView contract
}

let currentConversationsRef: Conversation[] = [];
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

        // If clicking directly on checkbox, let native toggle proceed and updateStat
        if (target.matches('input[type=checkbox]')) {
            return;
        }

        // Clicking anywhere else in the item row toggles selection
        const item = target.closest('.item') as HTMLElement | null;
        if (item) {
            const cb = item.querySelector('input[type=checkbox]') as HTMLInputElement | null;
            if (cb) {
                cb.checked = !cb.checked;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    list.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.matches('input[type=checkbox]')) {
            const item = (typeof (target as any).closest === 'function' ? (target as any).closest('.item') : null) as HTMLElement | null;
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
    conversations: Conversation[],
    exportedIds: Record<string, ExportRecord> = {},
    prevSelectedSet?: Set<string> | null,
    searchFilter: string = '',
    onDeleteChat?: (id: string) => void,
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
    } else if (canonicalSelectedIds === null) {
        // Initial load default: auto-check unexported and updated
        canonicalSelectedIds = new Set<string>();
        for (const c of currentConversationsRef) {
            const nid = normId(c.id);
            const rec = expMap[nid] || null;
            const isUpdated = checkIsUpdated(c, rec);
            if (!rec || isUpdated) {
                canonicalSelectedIds.add(c.id);
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
        const nid = normId(c.id);
        const rec = expMap[nid] || null;
        const isFailed = !!(
            (failedChatIds && (failedChatIds.has(c.id) || failedChatIds.has(nid) || failedChatIds.has('c_' + nid))) ||
            (rec && (rec.hasFailedAssets || rec.status === 'partial' || rec.status === 'failed'))
        );
        const isUnexported = !rec && !isFailed;
        const isExported = !!rec && !isFailed;

        let matchesType = true;
        if (filterType === 'unexported') {
            matchesType = isUnexported;
        } else if (filterType === 'failed') {
            matchesType = isFailed;
        } else if (filterType === 'unexported_or_failed') {
            matchesType = isUnexported || isFailed;
        } else if (filterType === 'exported') {
            matchesType = isExported;
        }

        if (!matchesType) return false;
        if (!q) return true;
        return (resolveTitle(c).title || '').toLowerCase().includes(q) || String(c.id || '').toLowerCase().includes(q);
    });

    if (!filtered.length) {
        list.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center; font-size:12px;">${typeof t === 'function' ? t('emptySearchList') : 'No matching conversations found.'}</div>`;
        return;
    }

    const htmlArr: string[] = [];
    const idxMap = new Map(conversations.map((c, idx) => [c as object, idx] as const));

    filtered.forEach((c) => {
        const origIdx = idxMap.get(c as object) ?? -1;
        const nid = normId(c.id);
        // Single canonical probe: expMap is normalized to canonical keys on the
        // read path (triage #5), so legacy 'c_<id>' alias keys no longer exist here.
        const rec = expMap[nid] || null;
        const isUpdated = checkIsUpdated(c, rec);
        let isChecked = false;
        if (canonicalSelectedIds) {
            isChecked = canonicalSelectedIds.has(c.id) || canonicalSelectedIds.has(nid) || canonicalSelectedIds.has('c_' + nid);
        } else if (prevSelectedSet instanceof Set) {
            isChecked = prevSelectedSet.has(c.id) || prevSelectedSet.has(nid) || prevSelectedSet.has('c_' + nid);
        } else {
            isChecked = !rec || isUpdated;
        }

        const resolved = resolveTitle(c);
        const displayTitle = escapeHtml(resolved.title);
        const isBad = !isRealTitle(resolved.title, c.id);
        const titleStyle = isBad ? 'color:var(--warn); opacity:0.85;' : '';

        let dateStr = '';
        const effTs = getEffectiveTimestamp(c);
        const ts = effTs || (c as any).updatedAt || c.timestamp;
        if (ts) {
            try {
                const d = typeof ts === 'string' ? new Date(ts) : new Date(Number(ts));
                if (!isNaN(d.getTime())) {
                    dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
            } catch { /* intentional */ }
        }

        let badgeHtml = '';
        if (rec) {
            let expDateStr = '';
            if (rec.exportedAt) {
                try {
                    const ed = typeof rec.exportedAt === 'string' ? new Date(rec.exportedAt) : new Date(Number(rec.exportedAt));
                    if (!isNaN(ed.getTime())) {
                        expDateStr = ed.toLocaleDateString();
                    }
                } catch { /* intentional */ }
            }
            if (isUpdated) {
                const badgeLabel = (typeof t === 'function' && (t('badgeUpdated') || t('badgeNeedsReexport'))) || 'Updated';
                badgeHtml = `<span class="badge badge-updated" style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(245,158,11,0.15); color:#f59e0b; margin-left:8px; border:1px solid rgba(245,158,11,0.35);">${badgeLabel}${expDateStr ? ` (${expDateStr})` : ''}</span>`;
            } else if (rec.status === 'partial' || rec.hasFailedAssets) {
                const badgeLabel = typeof t === 'function' ? t('badgeExportedPartial') : 'Exported (Partial Assets)';
                badgeHtml = `<span class="badge badge-exported-partial" style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(234,179,8,0.15); color:#eab308; margin-left:8px; border:1px solid rgba(234,179,8,0.3);">${badgeLabel}${expDateStr ? ` (${expDateStr})` : ''}</span>`;
            } else {
                const badgeLabel = typeof t === 'function' ? t('badgeExported') : 'Exported';
                badgeHtml = `<span class="badge badge-exported" style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(16,185,129,0.15); color:#10b981; margin-left:8px; border:1px solid rgba(16,185,129,0.3);">${badgeLabel}${expDateStr ? ` (${expDateStr})` : ''}</span>`;
            }
        }

        const url = (c as any).url || `https://gemini.google.com/app/${c.id}`;

        htmlArr.push(`
            <div class="item" data-chat-id="${escapeHtml(c.id)}" style="display:flex; align-items:center; padding:8px 12px; border-bottom:1px solid var(--border); font-size:13px; cursor:pointer; user-select:none;">
                <input type="checkbox" data-idx="${origIdx}" ${isChecked ? 'checked' : ''} style="margin-right:10px; cursor:pointer;" />
                <div style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    <span class="chat-title" style="${titleStyle}">${displayTitle}</span>
                    ${badgeHtml}
                </div>
                <span style="font-size:11px; color:var(--muted); margin-left:12px; white-space:nowrap;">${escapeHtml(dateStr)}</span>
                <a href="${escapeHtml(url)}" target="_blank" class="open-link" style="color:var(--muted); margin-left:10px; text-decoration:none; font-size:12px;" title="${escapeHtml(typeof t === 'function' ? t('openInGemini') : 'Open in Gemini')}">↗</a>
            </div>
        `);
    });

    list.innerHTML = htmlArr.join('');
}

export function updateItemExportStatus(chatId: string, exportRecord?: ExportRecord | null): void {
    if (!chatId) return;
    const nid = normId(chatId);
    const esc = (v: string): string =>
        (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
    const item = (document.querySelector && (
        document.querySelector(`#list .item[data-chat-id="${esc(nid)}"]`)
        || document.querySelector(`.item[data-chat-id="${esc(nid)}"]`)
        || document.querySelector(`[data-chat-id="${esc(chatId)}"]`)
        || document.querySelector(`[data-chat-id="${esc('c_' + nid)}"]`)
        || document.querySelector(`[data-chat-id="${esc(nid)}"]`)
    ));
    if (!item) return;

    const isPartial = !!(exportRecord && (exportRecord.status === 'partial' || exportRecord.hasFailedAssets));
    const badgeKey = isPartial ? 'badgeExportedPartial' : 'badgeExported';
    const bDefault = isPartial ? 'Exported (Partial Assets)' : 'Exported';
    const _i18n = __resolveModule('I18n', I18nStatic);
    const bText = (_i18n.t)
        ? _i18n.t(badgeKey)
        : (typeof t === 'function' ? t(badgeKey) : bDefault);
    const badgeText = (bText && bText !== badgeKey) ? bText : bDefault;
    const badgeClass = isPartial ? 'badge badge-exported-partial' : 'badge badge-exported';
    const badgeBg = isPartial ? 'rgba(234,179,8,0.15)' : 'rgba(16,185,129,0.15)';
    const badgeBorder = isPartial ? 'rgba(234,179,8,0.3)' : 'rgba(16,185,129,0.3)';
    const badgeColor = isPartial ? '#eab308' : '#10b981';

    let badge = item.querySelector ? item.querySelector('.badge') as HTMLElement | null : null;
    if (badge) {
        badge.className = badgeClass;
        badge.textContent = badgeText;
        if ((badge as HTMLElement).style) {
            (badge as HTMLElement).style.background = badgeBg;
            (badge as HTMLElement).style.borderColor = badgeBorder;
            (badge as HTMLElement).style.color = badgeColor;
        }
    } else {
        const titleContainer = item.querySelector ? item.querySelector('div') : null;
        if (titleContainer && document.createElement) {
            const span = document.createElement('span');
            span.className = badgeClass;
            span.style.cssText = `font-size:10px; padding:2px 6px; border-radius:4px; background:${badgeBg}; color:${badgeColor}; margin-left:8px; border:1px solid ${badgeBorder};`;
            span.textContent = badgeText;
            titleContainer.appendChild(span);
        }
    }
}

export function updateStat(conversations?: Conversation[]): void {
    const list = $('list');
    if (!list) return;
    const convs = conversations || currentConversationsRef || [];
    const total = convs.length;
    let checked = 0;
    if (canonicalSelectedIds && canonicalSelectedIds.size > 0 && convs.length > 0) {
        checked = convs.filter(c => {
            const nid = normId(c.id);
            return canonicalSelectedIds!.has(c.id) || canonicalSelectedIds!.has(nid) || canonicalSelectedIds!.has('c_' + nid);
        }).length;
    } else {
        checked = document.querySelectorAll('#list input[type=checkbox]:checked').length;
    }
    const statEl = $('selectedStat') || $('stat');
    if (statEl) {
        statEl.textContent = typeof t === 'function' ? t('selectedStat', checked, total) : `${checked} of ${total} selected`;
    }
}

export function getSelected(conversations?: Conversation[]): Conversation[] {
    const convs = conversations || currentConversationsRef || [];
    if (canonicalSelectedIds && canonicalSelectedIds.size > 0) {
        const selected = convs.filter(c => {
            const nid = normId(c.id);
            return canonicalSelectedIds!.has(c.id) || canonicalSelectedIds!.has(nid) || canonicalSelectedIds!.has('c_' + nid);
        });
        if (selected.length > 0) return selected;
    }
    const selected: Conversation[] = [];
    document.querySelectorAll('#list input[type=checkbox]:checked').forEach((cb) => {
        const item = typeof (cb as any).closest === 'function' ? ((cb as any).closest('.item') as HTMLElement | null) : null;
        const chatId = item?.dataset?.chatId;
        if (chatId) {
            const found = convs.find(c => normId(c.id) === normId(chatId));
            if (found) {
                selected.push(found);
                return;
            }
        }
        const idx = parseInt((cb as HTMLElement).dataset?.idx || '-1', 10);
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
    document.querySelectorAll('#list input[type=checkbox]:checked').forEach((cb) => {
        const item = typeof (cb as any).closest === 'function' ? ((cb as any).closest('.item') as HTMLElement | null) : null;
        const chatId = item?.dataset?.chatId;
        if (chatId) ids.add(chatId);
    });
    return ids;
}

export function selectAll(conversations?: Conversation[]): void {
    if (!canonicalSelectedIds) canonicalSelectedIds = new Set<string>();
    document.querySelectorAll('#list input[type=checkbox]').forEach((cb) => {
        (cb as HTMLInputElement).checked = true;
        const item = typeof (cb as any).closest === 'function' ? ((cb as any).closest('.item') as HTMLElement | null) : null;
        const chatId = item?.dataset?.chatId;
        if (chatId) {
            canonicalSelectedIds!.add(chatId);
            canonicalSelectedIds!.add(normId(chatId));
        } else {
            const idx = parseInt((cb as HTMLElement).dataset?.idx || '-1', 10);
            const convs = conversations || currentConversationsRef || [];
            if (idx >= 0 && convs[idx]) {
                canonicalSelectedIds!.add(convs[idx].id);
                canonicalSelectedIds!.add(normId(convs[idx].id));
            }
        }
    });
    updateStat(conversations);
}

export function deselectAll(conversations?: Conversation[]): void {
    if (!canonicalSelectedIds) canonicalSelectedIds = new Set<string>();
    document.querySelectorAll('#list input[type=checkbox]').forEach((cb) => {
        (cb as HTMLInputElement).checked = false;
        const item = typeof (cb as any).closest === 'function' ? ((cb as any).closest('.item') as HTMLElement | null) : null;
        const chatId = item?.dataset?.chatId;
        if (chatId) {
            const nid = normId(chatId);
            canonicalSelectedIds!.delete(chatId);
            canonicalSelectedIds!.delete(nid);
            canonicalSelectedIds!.delete('c_' + nid);
        } else {
            const idx = parseInt((cb as HTMLElement).dataset?.idx || '-1', 10);
            const convs = conversations || currentConversationsRef || [];
            if (idx >= 0 && convs[idx]) {
                const nid = normId(convs[idx].id);
                canonicalSelectedIds!.delete(convs[idx].id);
                canonicalSelectedIds!.delete(nid);
                canonicalSelectedIds!.delete('c_' + nid);
            }
        }
    });
    updateStat(conversations);
}

export function selectUnexported(conversations?: Conversation[], exportedIds?: Record<string, ExportRecord>): void {
    const convList = conversations || currentConversationsRef || [];
    const expMap = exportedIds || {};
    if (!canonicalSelectedIds) canonicalSelectedIds = new Set<string>();
    document.querySelectorAll('#list input[type=checkbox]').forEach((cb) => {
        const idx = parseInt((cb as HTMLElement).dataset?.idx || '-1', 10);
        const c = convList[idx];
        if (!c) {
            (cb as HTMLInputElement).checked = false;
            return;
        }
        const nid = normId(c.id);
        const rec = expMap[nid] || null;
        const check = !rec;
        (cb as HTMLInputElement).checked = check;
        if (check) {
            canonicalSelectedIds!.add(c.id);
            canonicalSelectedIds!.add(nid);
        } else {
            canonicalSelectedIds!.delete(c.id);
            canonicalSelectedIds!.delete(nid);
            canonicalSelectedIds!.delete('c_' + nid);
        }
    });
    updateStat(conversations);
}

export function selectNeedsUpdate(conversations?: Conversation[], exportedIds?: Record<string, ExportRecord>): void {
    const convList = conversations || currentConversationsRef || [];
    const expMap = exportedIds || {};
    if (!canonicalSelectedIds) canonicalSelectedIds = new Set<string>();
    document.querySelectorAll('#list input[type=checkbox]').forEach((cb) => {
        const idx = parseInt((cb as HTMLElement).dataset?.idx || '-1', 10);
        const c = convList[idx];
        if (!c) {
            (cb as HTMLInputElement).checked = false;
            return;
        }
        const nid = normId(c.id);
        const rec = expMap[nid] || null;
        const check = checkIsUpdated(c, rec);
        (cb as HTMLInputElement).checked = check;
        if (check) {
            canonicalSelectedIds!.add(c.id);
            canonicalSelectedIds!.add(nid);
        } else {
            canonicalSelectedIds!.delete(c.id);
            canonicalSelectedIds!.delete(nid);
            canonicalSelectedIds!.delete('c_' + nid);
        }
    });
    updateStat(conversations);
}

export function selectByIds(targetIds: Set<string> | string[], conversations?: Conversation[]): void {
    const idSet = new Set(Array.from(targetIds).map(id => normId(id)));
    canonicalSelectedIds = new Set(idSet);
    document.querySelectorAll('#list input[type=checkbox]').forEach((cb) => {
        const item = typeof (cb as any).closest === 'function' ? ((cb as any).closest('.item') as HTMLElement | null) : null;
        const chatId = normId(item?.dataset?.chatId);
        (cb as HTMLInputElement).checked = !!chatId && idSet.has(chatId);
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
    selectNeedsUpdate,
    selectByIds,
    setSelectedIds,
    isRealTitle,
    setOnDelete,
    updateItemExportStatus,
    checkIsUpdated
};

(ListView as any).checkIsUpdated = checkIsUpdated;


export default ListView;
