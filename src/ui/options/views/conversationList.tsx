import { isSourcePlatform, platformConversationUrl, platformDisplayName } from '../../../shared/platformHosts.js';
import { attachmentFailure, attachmentIssueText } from '../../shared/exportSummary.js';
import { resourceIssueKind } from '../../../shared/resources/resourceResult.js';
import { indexActivityTime, type DomainConversationIndex } from '../../../l2/conversationIndex.js';
import type { Account } from '../../../l2/accountRegistry.js';
import type { ExportRecord } from '../../../application/export/types.js';
import { text, uiLocale } from '../../shared/settings.js';

interface ConversationRowFacts {
    index: DomainConversationIndex;
    record: ExportRecord | undefined;
    selected: boolean;
    prepared: boolean;
    failed: boolean;
}
interface ConversationListProps {
    rows: readonly ConversationRowFacts[];
    totalCount?: number;
    disabled: boolean;
    provider: Account['providerId'] | undefined;
    developerMode: boolean;
    onSelect: (id: string, selected: boolean, shiftKey?: boolean) => void;
    onSync?: () => void;
    onResetFilters?: () => void;
}

/** Display recent ExportRecord facts and transient delivery results; Application still owns Skip. */
function viewStatus(index: DomainConversationIndex, record: ExportRecord | undefined, prepared: boolean, failed: boolean, developerMode: boolean) {
    if (failed) return { label: text('Export failed', '导出失败'), className: 'status-failed' };
    if (prepared) return { label: text('Rendered, awaiting download', '渲染成功，等待下载'), className: 'status-prepared' };
    if (!record) return { label: '', className: '' };
    if (record.status === 'partial' && (developerMode || record.otherContentMissing || !record.attachmentIssues?.length)) {
        if (record.otherContentMissing || !record.attachmentIssues?.length)
            return { label: text('Incomplete export', '导出不完整'), className: 'status-partial' };
        const onlyExpired = record.attachmentIssues.every(issue =>
            resourceIssueKind(attachmentFailure(issue)) === 'expired');
        return onlyExpired
            ? { label: text('Some source attachments unavailable', '部分来源附件无法获取'), className: 'status-unavailable' }
            : { label: text('Some attachments failed', '部分附件获取失败'), className: 'status-unavailable' };
    }
    if (record.chatTime !== undefined && index.updatedAt !== undefined
        && Number.isSafeInteger(record.chatTime) && Number.isSafeInteger(index.updatedAt)
        && index.updatedAt > record.chatTime)
        return { label: text('Updated', '有更新'), className: 'status-updated' };
    return { label: text(`Export successful (${date(record.exportedAt)})`, `导出成功（${date(record.exportedAt)}）`), className: 'status-exported' };
}
function date(value: number | undefined): string {
    return value === undefined || !Number.isFinite(value) ? '' : new Date(value).toLocaleString(uiLocale());
}

function AttachmentIssue({ issue }: { issue: NonNullable<ExportRecord['attachmentIssues']>[number] }) {
    let source: URL | undefined;
    if (issue.sourceUrl) {
        try {
            const url = new URL(issue.sourceUrl);
            if (url.protocol === 'https:' && !url.username && !url.password) source = url;
        } catch { /* Older records may contain an invalid source locator. */ }
    }
    return <div>{attachmentIssueText(issue)}{source && <>
        {' '}<a href={source.href} target="_blank" rel="noopener noreferrer">{text('Open source', '查看来源')}</a>
    </>}</div>;
}

function sourceTurnNote(sourceTurn: ExportRecord['sourceTurn']): string | null {
    if (!sourceTurn || sourceTurn === 'finished') return null;
    return sourceTurn === 'unfinished' ? text('Source reply has not ended', '原回答尚未结束')
        : sourceTurn === 'interrupted' ? text('Source reply was interrupted', '原回答已中断')
        : sourceTurn === 'handoff' ? text('Source is at a handoff', '原对话停在交接步骤')
        : sourceTurn === 'awaiting_reply' ? text('Source ends with a user message', '来源最后为用户消息')
        : sourceTurn === 'tool_pending' ? text('Source ends at a tool step', '来源停在工具步骤')
        : text('Source reply completion unconfirmed; available content saved', '原回答结束状态未确认，已保存可用正文');
}

function ConversationRow({ row, disabled, provider, developerMode, onSelect }: Omit<ConversationListProps, 'rows'> & { row: ConversationRowFacts }) {
    const { index, record, selected, prepared, failed } = row;
    const id = index.key.conversationId;
    const status = viewStatus(index, record, prepared, failed, developerMode);
    const note = sourceTurnNote(record?.sourceTurn);
    const targetPlatform = isSourcePlatform(provider) ? provider : 'gemini';
    const platformName = platformDisplayName(targetPlatform);
    const openLabel = text(`Open in ${platformName}`, `在 ${platformName} 中打开`);
    const conversationHref = platformConversationUrl(targetPlatform, id);
    return <div className="item" data-chat-id={id} data-account-id={index.key.accountId}
        data-selected={selected} onClick={event => {
            if (disabled || event.target instanceof Element && event.target.closest('input, a, details, button')) return;
            onSelect(id, !selected, event.shiftKey);
        }}>
        <input type="checkbox" checked={selected} disabled={disabled}
            aria-label={text(`Select ${index.title || id}`, `选择 ${index.title || id}`)}
            onClick={event => {
                if (event.shiftKey) {
                    event.preventDefault();
                    onSelect(id, !selected, true);
                }
            }}
            onChange={event => onSelect(id, event.currentTarget.checked, false)} />
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                <span className="chat-title title" style={index.title ? undefined : { color: 'var(--warn)' }}>{index.title || id}</span>
                {status.className && <span className={`status-tag ${status.className}`}>{status.label}</span>}
            </div>
            <small className="meta" style={{ display: 'block' }}>{[
                date(indexActivityTime(index)), record ? `${text('Last export', '上次导出')} · ${record.format}` : '',
            ].filter(Boolean).join(' · ')}</small>
            {note && <div className="source-turn-status">{note}</div>}
            {developerMode && !!record?.attachmentIssues?.length && <details className="attachment-issues" onClick={event => event.stopPropagation()}>
                <summary>{text(`Attachment details (${record.attachmentIssues.length})`, `附件详情（${record.attachmentIssues.length}）`)}</summary>
                {record.attachmentIssues.map((issue, position) => <AttachmentIssue key={`${issue.resourceId}:${position}`} issue={issue} />)}
            </details>}
        </div>
        {/* Provider-supplied URLs never become navigation destinations. */}
        <a className="open-link" href={conversationHref} target="_blank" rel="noopener noreferrer"
            title={openLabel} aria-label={openLabel}>↗</a>
    </div>;
}

export function ConversationList({ rows, totalCount = 0, onSync, onResetFilters, ...props }: ConversationListProps) {
    if (!rows.length) {
        const hasAny = totalCount > 0;
        return <div className="list-empty-state">
            <svg className="list-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {hasAny
                    ? <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" /><path d="M8.5 11h5" /></>
                    : <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /><path d="M8 10h8M8 14h5" /></>}
            </svg>
            <div className="list-empty-title">
                {hasAny
                    ? text('No conversations match this view', '当前视图没有对话')
                    : text('No conversations synced yet', '暂无已同步的对话')}
            </div>
            <div className="list-empty-desc">
                {hasAny
                    ? text('Try clearing your search keyword or switching the status filter.', '尝试清空搜索关键词或重置状态筛选条件。')
                    : text('Click Sync All to fetch conversations from the connected platform.', '点击「同步会话」从当前已授权平台拉取对话列表。')}
            </div>
            {hasAny && onResetFilters && (
                <button type="button" className="ghost small" disabled={props.disabled} onClick={onResetFilters}>
                    {text('Clear filters', '重置筛选')}
                </button>
            )}
            {!hasAny && onSync && (
                <button type="button" className="primary small" disabled={props.disabled} onClick={onSync}>
                    {text('Sync All', '同步会话')}
                </button>
            )}
        </div>;
    }
    return <>{rows.map(row => <ConversationRow key={`${row.index.key.accountId}:${row.index.key.conversationId}`} row={row} {...props} />)}</>;
}
