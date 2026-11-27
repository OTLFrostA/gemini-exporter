import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { elementById, requiredElement } from '../../shared/elements.js';
import type { ConversationViewState } from '../state/conversationsStore.js';
import { text, isDeveloperMode } from '../../shared/settings.js';
import { ConversationList } from './conversationList.js';

// Only this adapter touches the legacy workbench's DOM and mutable selection.
// React exclusively owns #list's descendants; Application owns all export facts.
const roots = new WeakMap<HTMLElement, Root>();

export function unmountList(): void {
    const list = elementById('list');
    roots.get(list)?.unmount();
    roots.delete(list);
}

export function renderList(
    state: ConversationViewState,
    disabled: boolean,
    preparedKeys?: ReadonlySet<string>,
    failedKeys?: ReadonlySet<string>,
    guidedSelection = false,
    skipPreview?: { readonly skipExported: boolean; readonly format: string },
    exportActionLabel?: string,
): void {
    const list = elementById('list');
    let root = roots.get(list);
    if (!root) { root = createRoot(list); roots.set(list, root); }
    const provider = state.accounts.find(account => account.id === state.accountId)?.providerId;
    const rows = state.visible().map(index => ({
        index,
        record: state.records[index.key.conversationId],
        selected: state.selected.has(index.key.conversationId),
        prepared: preparedKeys?.has(index.key.conversationId) ?? false,
        failed: failedKeys?.has(index.key.conversationId) ?? false,
    }));
    // Existing workbench code and guidance read the DOM immediately after render.
    // Keep that synchronous contract at the migration boundary only.
    flushSync(() => root.render(createElement(ConversationList, {
        rows, totalCount: state.indexes.length, disabled, provider, developerMode: isDeveloperMode(),
        onSelect: (id: string, selected: boolean, shiftKey = false) => {
            if (disabled) return;
            const anchor = state.selectionAnchor;
            if (shiftKey && !guidedSelection && anchor) {
                const orderedIds = rows.map(row => row.index.key.conversationId);
                const start = orderedIds.indexOf(anchor);
                const end = orderedIds.indexOf(id);
                if (start !== -1 && end !== -1) {
                    const [lo, hi] = start <= end ? [start, end] : [end, start];
                    for (let i = lo; i <= hi; i++) {
                        if (selected) state.selected.add(orderedIds[i]);
                        else state.selected.delete(orderedIds[i]);
                    }
                } else if (selected) state.selected.add(id);
                else state.selected.delete(id);
            } else if (selected) {
                if (guidedSelection) state.selected.clear();
                state.selected.add(id);
            } else {
                state.selected.delete(id);
            }
            state.selectionAnchor = id;
            renderList(state, disabled, preparedKeys, failedKeys, guidedSelection, skipPreview, exportActionLabel);
            // The legacy tour observes selection intent, including row-title clicks.
            list.dispatchEvent(new Event('conversation-selection-change'));
        },
        onSync: () => {
            const syncBtn = document.getElementById('btnSyncAll') as HTMLButtonElement | null;
            if (syncBtn && !syncBtn.disabled) syncBtn.click();
        },
        onResetFilters: () => {
            state.search = '';
            state.filter = 'all';
            const searchInput = document.getElementById('chatSearchInput') as HTMLInputElement | null;
            if (searchInput) searchInput.value = '';
            const filterSelect = document.getElementById('chatFilterSelect') as HTMLSelectElement | null;
            if (filterSelect) filterSelect.value = 'all';
            renderList(state, disabled, preparedKeys, failedKeys, guidedSelection, skipPreview, exportActionLabel);
        },
    })));
    updateStat(state, disabled, skipPreview, exportActionLabel);
}

function updateStat(
    state: ConversationViewState,
    disabled: boolean,
    skipPreview?: { readonly skipExported: boolean; readonly format: string },
    exportActionLabel?: string,
): void {
    const clearSearchBtn = document.getElementById('btnClearSearch') as HTMLButtonElement | null;
    if (clearSearchBtn) clearSearchBtn.hidden = !state.search;
    const visible = state.visible();
    const selectedVisible = visible.filter(row => state.selected.has(row.key.conversationId)).length;
    const selectAll = requiredElement('input', 'btnSelectAll');
    selectAll.checked = visible.length > 0 && selectedVisible === visible.length;
    selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    selectAll.disabled = visible.length === 0 || disabled;
    const label = selectAll.checked
        ? text('Clear selection', '清空选择')
        : text('Select all visible conversations', '全选当前可见会话');
    selectAll.setAttribute('aria-label', label);
    selectAll.title = label;
    const total = state.indexes.length;
    const hiddenCount = state.hiddenSelection().length;
    const hiddenReason = state.filter === 'all' ? text('by search', '未在搜索结果中显示')
        : state.search.trim() ? text('by search or filter', '未在搜索或筛选结果中显示')
            : text('by filter', '未在筛选结果中显示');
    elementById('hiddenSelectionNotice').hidden = hiddenCount === 0;
    elementById('hiddenSelectionText').textContent = hiddenCount
        ? text(`${hiddenCount} selected ${hiddenCount === 1 ? 'conversation' : 'conversations'} hidden ${hiddenReason}`, `已选 ${hiddenCount} 个会话${hiddenReason}`) : '';
    requiredElement('button', 'btnShowHiddenSelection').disabled = disabled;
    requiredElement('button', 'btnDeselectHidden').disabled = disabled;
    elementById('selectedStat').textContent =
        text(`${state.selected.size} of ${total} selected`, `已选 ${state.selected.size} / ${total}`);
    const skipHint = document.getElementById('skipSelectedHint');
    if (skipHint) {
        let skippable = 0;
        if (skipPreview?.skipExported && state.selected.size > 0) {
            for (const index of state.indexes) {
                const id = index.key.conversationId;
                if (!state.selected.has(id)) continue;
                const record = state.records[id];
                if (record && record.status === 'ok' && record.format === skipPreview.format
                    && record.chatTime !== undefined && index.updatedAt !== undefined
                    && Number.isSafeInteger(record.chatTime) && Number.isSafeInteger(index.updatedAt)
                    && record.chatTime >= index.updatedAt) {
                    skippable++;
                }
            }
        }
        skipHint.hidden = skippable === 0;
        skipHint.textContent = skippable > 0
            ? text(`· ${skippable} unchanged will skip`, `· ${skippable} 条未更新将跳过`)
            : '';
    }
    const button = requiredElement('button', 'btnExport');
    button.disabled = !state.selected.size || disabled;
    button.textContent = exportActionLabel ?? (state.selected.size > 0
        ? text(`Export selected (${state.selected.size})`, `导出选中 (${state.selected.size})`)
        : text('Export selected', '导出选中'));
}
