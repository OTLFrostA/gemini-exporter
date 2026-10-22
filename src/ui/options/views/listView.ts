import { attachmentFailure, attachmentIssueText } from '../../shared/exportSummary.js';
import { resourceIssueKind } from '../../../shared/resources/resourceResult.js';
import { indexActivityTime } from '../../../l2/conversationIndex.js';
import type { DomainConversationIndex } from '../../../l2/conversationIndex.js';
import type { ExportRecord } from '../../../application/export/types.js';
import type { ConversationViewState } from '../state/conversationsStore.js';
import { text } from '../../shared/settings.js';

/** Display recent ExportRecord facts and transient delivery results; Application still owns Skip. */
function viewStatus(index: DomainConversationIndex, record: ExportRecord | undefined, prepared: boolean, failed: boolean) {
    if (failed) return { label: text('Export failed', '导出失败'), className: 'status-failed' };
    if (prepared) return { label: text('Rendered, awaiting download', '渲染成功，等待下载'), className: 'status-prepared' };
    if (!record) return { label: '', className: '' };
    if (record.status === 'partial') {
        if (record.otherContentMissing || !record.attachmentIssues?.length)
            return { label: text('Incomplete export', '导出不完整'), className: 'status-partial' };
        const onlyExpired = record.attachmentIssues.every(issue =>
            resourceIssueKind(attachmentFailure(issue)) === 'expired');
        return onlyExpired
            ? { label: text('Some attachments expired', '部分附件过期'), className: 'status-unavailable' }
            : { label: text('Some attachments failed', '部分附件获取失败'), className: 'status-unavailable' };
    }
    if (record.chatTime !== undefined && index.updatedAt !== undefined
        && Number.isSafeInteger(record.chatTime) && Number.isSafeInteger(index.updatedAt)
        && index.updatedAt > record.chatTime)
        return { label: text('Updated', '有更新'), className: 'status-updated' };
    return { label: text(`Export successful (${date(record.exportedAt)})`, `导出成功（${date(record.exportedAt)}）`), className: 'status-exported' };
}
function date(value: number | undefined): string {
    return value === undefined || !Number.isFinite(value) ? '' : new Date(value).toLocaleString();
}

export function renderList(state: ConversationViewState, disabled: boolean, preparedKeys?: ReadonlySet<string>, failedKeys?: ReadonlySet<string>): void {
    const list = document.getElementById('list')!;
    list.replaceChildren();
    for (const index of state.visible()) {
        const id = index.key.conversationId;
        const record = state.records[id];
        const status = viewStatus(index, record, preparedKeys?.has(id) ?? false, failedKeys?.has(id) ?? false);
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
        const seen = date(indexActivityTime(index));
        meta.textContent = [seen, record ? `${text('Last export', '上次导出')} · ${record.format}` : ''].filter(Boolean).join(' · ');
        body.append(heading, meta);
        if (record?.attachmentIssues?.length) {
            const details = document.createElement('details'); details.className = 'attachment-issues';
            details.addEventListener('click', event => event.stopPropagation());
            const summary = document.createElement('summary');
            summary.textContent = text(`Attachment details (${record.attachmentIssues.length})`, `附件详情（${record.attachmentIssues.length}）`);
            details.append(summary);
            for (const issue of record.attachmentIssues) {
                const line = document.createElement('div'); line.textContent = attachmentIssueText(issue);
                if (issue.sourceUrl) {
                    try {
                        const url = new URL(issue.sourceUrl);
                        if (url.protocol === 'https:' && !url.username && !url.password) {
                            const source = document.createElement('a'); source.href = url.href;
                            source.textContent = text('Open source', '查看来源'); source.target = '_blank'; source.rel = 'noopener noreferrer';
                            line.append(' ', source);
                        }
                    } catch { /* Older records may contain an invalid source locator. */ }
                }
                details.append(line);
            }
            body.append(details);
        }
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
