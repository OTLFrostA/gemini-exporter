import type { DomainConversationIndex } from '../../../l2/conversationIndex.js';
import type { ExportRecord } from '../../../application/export/types.js';
import type { ConversationViewState } from '../state/conversationsStore.js';
import { text } from '../../shared/settings.js';

/** Presentation-only status. Domain and Application remain authorities for updates and Skip. */
function viewStatus(record: ExportRecord | undefined) {
    if (!record) return { label: text('No export record', '无导出记录'), className: '' };
    if (record.status === 'partial') return { label: text('Partial export', '部分导出'), className: 'status-partial' };
    return { label: text('Last export complete', '上次导出完整'), className: 'status-exported' };
}
function date(value: number | undefined): string {
    return value === undefined || !Number.isFinite(value) ? '' : new Date(value).toLocaleString();
}

export function renderList(state: ConversationViewState, disabled: boolean, preparedKeys?: ReadonlySet<string>): void {
    const list = document.getElementById('list')!;
    list.replaceChildren();
    for (const index of state.visible()) {
        const id = index.key.conversationId;
        const record = state.records[id];
        const prepared = preparedKeys?.has(id) ?? false;
        const status = prepared
            ? { label: text('Prepared for download', '已准备，待下载'), className: 'status-prepared' }
            : viewStatus(record);
        const row = document.createElement('div');
        row.className = 'item'; row.dataset.chatId = id;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(id); checkbox.disabled = disabled;
        checkbox.setAttribute('aria-label', text('Select conversation', '选择会话'));
        const select = () => {
            if (disabled) return;
            if (checkbox.checked) state.selected.add(id); else state.selected.delete(id);
            updateStat(state);
        };
        checkbox.addEventListener('change', select);

        const body = document.createElement('div');
        body.style.cssText = 'flex:1;min-width:0;cursor:pointer';
        const heading = document.createElement('div');
        heading.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:4px';
        const title = document.createElement('span'); title.className = 'chat-title title';
        title.textContent = index.title || id;
        if (!index.title) title.style.color = 'var(--warn)';
        heading.append(title);
        if (status.className) {
            const badge = document.createElement('span');
            badge.className = 'status-tag ' + status.className;
            badge.textContent = status.label;
            heading.append(badge);
        }
        const meta = document.createElement('small'); meta.className = 'meta'; meta.style.display = 'block';
        const seen = date(index.updatedAt);
        const exported = date(record?.exportedAt);
        meta.textContent = [seen, prepared ? status.label : record
            ? `${text('Last export', '上次导出')} · ${record.format} · ${exported} · ${status.label}`
            : text('No export record', '无导出记录')].filter(Boolean).join(' · ');
        body.append(heading, meta);
        body.addEventListener('click', () => {
            if (disabled) return;
            checkbox.checked = !checkbox.checked;
            select();
        });

        const open = document.createElement('a');
        // Never link a provider-supplied URL. Construct a fixed-origin destination from the trusted conversation ID.
        open.href = 'https://gemini.google.com/app/' + encodeURIComponent(id);
        open.target = '_blank'; open.rel = 'noopener noreferrer'; open.className = 'open-link';
        open.title = text('Open in Gemini', '在 Gemini 中打开');
        open.textContent = '↗';
        open.setAttribute('aria-label', open.title);
        row.append(checkbox, body, open);
        list.append(row);
    }
    if (!list.children.length) list.textContent = text('No conversations match this view', '当前视图没有对话');
    updateStat(state);
}

export function updateStat(state: ConversationViewState): void {
    const total = state.indexes.length;
    document.getElementById('selectedStat')!.textContent =
        text(`${state.selected.size} of ${total} selected`, `已选 ${state.selected.size} / ${total}`);
    const button = document.getElementById('btnExport') as HTMLButtonElement;
    button.disabled = !state.selected.size || document.body.dataset.busy === 'true';
}
