import type { ConversationViewState } from '../state/conversationsStore.js';
import { text } from '../utils/settings.js';

export function renderList(state: ConversationViewState, disabled: boolean): void {
    const list = document.getElementById('list')!;
    list.replaceChildren();
    for (const index of state.visible()) {
        const row = document.createElement('label'); row.className = 'item'; row.dataset.chatId = index.key.conversationId;
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
        checkbox.checked = state.selected.has(index.key.conversationId); checkbox.disabled = disabled;
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) state.selected.add(index.key.conversationId); else state.selected.delete(index.key.conversationId);
            updateStat(state);
        });
        const title = document.createElement('span'); title.textContent = index.title || index.key.conversationId;
        const detail = document.createElement('small');
        const record = state.records[index.key.conversationId];
        detail.textContent = [index.updatedAt === undefined ? '' : new Date(index.updatedAt).toLocaleString(), record
            ? `${record.status === 'partial' ? text('Partial export', '部分导出') : text('Last export', '上次导出')} · ${record.format} · ${new Date(record.exportedAt).toLocaleString()}`
            : text('No export record', '无导出记录')].filter(Boolean).join(' · ');
        row.append(checkbox, title, detail); list.append(row);
    }
    if (!list.children.length) list.textContent = text('No conversations match this view', '当前视图没有对话');
    updateStat(state);
}
export function updateStat(state: ConversationViewState): void {
    document.getElementById('selectedStat')!.textContent = text(`${state.selected.size} selected`, `已选 ${state.selected.size} 条`);
    const button = document.getElementById('btnExport') as HTMLButtonElement;
    button.disabled = !state.selected.size || document.body.dataset.busy === 'true';
}
