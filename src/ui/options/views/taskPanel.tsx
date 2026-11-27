import { createPortal } from 'react-dom';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import type { ForegroundTaskStatus, ScanEvidence, TaskFeedback } from '../state/foregroundTask.js';
import { englishCount, text } from '../../shared/settings.js';
import { failureGroupLabel, failureGroupTier, prepareDisplayFailureGroups } from './exportFailures.js';
import type { ExportIssueGroup } from '../state/exportIssues.js';
import type { ConversationSourceSummary } from '../../shared/conversationSourceSummary.js';

export interface TaskPanelProps {
    task: ForegroundTaskStatus;
    feedback: TaskFeedback;
    showTask?: boolean;
    percent: number;
    scanning: boolean;
    scanMessage: string | null;
    scanEvidence?: ScanEvidence;
    sourceSummary?: ConversationSourceSummary & { accountId: string | null; total: number };
    scanSlow: boolean;
    onTakeout?: () => void;
    groups: readonly ExportIssueGroup[];
    failedCount: number;
    dismissed: boolean;
    developerMode: boolean;
    ready: boolean;
    onCancel: () => void;
    onRetry: () => void;
    onDismiss: () => void;
    onCopy: () => void;
    onSelectConversation: (key: ConversationKey) => void;
}

function FailureCard({ groups, failedCount, dismissed, developerMode, task, ready, onRetry, onDismiss, onCopy, onSelectConversation }: TaskPanelProps) {
    const filteredGroups = groups.filter(group => developerMode || (
        group.severity === 'error'
        && !['resource', 'resource_refresh', 'source_parse', 'detail', 'source_refresh'].includes(group.diagnostic.stage)
        && !group.category.startsWith('RESOURCE_')
        && !/(?:^|_)(?:ASSET|IMAGE)(?:_|$)/.test(group.diagnostic.code)
        && group.category !== 'DETAIL_NOT_COMPLETE'
        && group.category !== 'SOURCE_REFRESH_FAILED'
        && group.category !== 'EXPORTED_FROM_LOCAL_DELETED_AT_SOURCE'
    ));
    const visibleGroups = prepareDisplayFailureGroups(filteredGroups);
    const hasErrors = failedCount > 0 || visibleGroups.some(group => group.severity === 'error');
    const title = hasErrors
        ? failedCount ? text(`${englishCount(failedCount, 'conversation')} failed · Issue groups: ${visibleGroups.length}`,
            `${failedCount} 条会话导出失败 · ${visibleGroups.length} 组问题`)
            : text(`Export errors · Issue groups: ${visibleGroups.length}`, `导出错误 · ${visibleGroups.length} 组问题`)
        : text(`Export warnings · Issue groups: ${visibleGroups.length}`, `导出警告 · ${visibleGroups.length} 组提示`);
    return <div id="exportFailureCard" className="export-issues" data-severity={hasErrors ? 'error' : 'warning'}
        style={{ display: visibleGroups.length && !dismissed ? 'block' : 'none' }}>
        <div className="export-issues-header">
            <span id="exportFailureTitle">{title}</span>
            <div style={{ display: 'flex', gap: 6 }}>
                <button id="btnCopyFailedLog" className="small ghost" style={{ padding: '2px 8px', fontSize: 11, borderColor: 'var(--subtle-button-border, rgba(255,255,255,0.15))', color: 'var(--text)' }}
                    onClick={onCopy}>{text('Copy Diagnostics', '复制诊断')}</button>
                <button id="btnRetryFailed" className="small ghost" hidden={!failedCount} disabled={task.kind !== 'idle' || !ready}
                    style={{ padding: '2px 8px', fontSize: 11, borderColor: 'rgba(239,68,68,0.4)', color: 'var(--danger, #f87171)' }}
                    onClick={onRetry}>{text('Retry Failed', '重试失败项')}</button>
                <button id="btnDismissFailure" className="small ghost" title={text('Close', '关闭')}
                    style={{ padding: '2px 6px', fontSize: 11, color: 'var(--text-muted)' }} onClick={onDismiss}>✕</button>
            </div>
        </div>
        <div id="exportFailureList" style={{ maxHeight: 160, overflowY: 'auto', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.4 }}>
            {visibleGroups.map(group => {
                const tier = failureGroupTier(group);
                return <details key={JSON.stringify([group.category, group.httpStatus, group.category === 'UNKNOWN_ERROR' ? group.diagnostic.stage : null])}
                    data-severity={group.severity} data-tier={tier} className="issue-group">
                    <summary>{failureGroupLabel(group)}</summary>
                    <div className="issue-diagnostic-sample">{text('Example diagnostic: ', '示例诊断：')}
                        {`[${group.diagnostic.stage} / ${group.diagnostic.code}] ${group.diagnostic.message}`}</div>
                    <div className="issue-conv-list">
                        {group.conversations.map(({ key, title: convTitle }) => {
                            const label = convTitle ? `${convTitle} (${key.conversationId})` : key.conversationId;
                            return <button key={`${key.accountId}/${key.conversationId}`} type="button" className="issue-conv-btn"
                                title={text(`Locate in list: ${label}`, `在右侧列表中定位：${label}`)}
                                onClick={() => onSelectConversation(key)}>
                                <span className="issue-conv-label">{label}</span>
                                <span className="issue-conv-jump" aria-hidden="true">→</span>
                            </button>;
                        })}
                    </div>
                </details>;
            })}
        </div>
    </div>;
}

export function TaskPanel({ failureHost, ...props }: TaskPanelProps & { failureHost: HTMLElement }) {
    const { task, feedback, showTask = true, percent, scanning, scanMessage, scanSlow, onCancel } = props;
    const exporting = task.kind === 'export';
    const determinateTask = exporting || task.kind === 'takeout';
    const indeterminate = scanning && !determinateTask;
    const message = feedback.kind === 'empty' ? '' : typeof feedback.message === 'function' ? feedback.message() : feedback.message;
    return <>
        <p id="exportOptionsLock" role="status" hidden={!exporting} style={{ margin: 0, textAlign: 'center', fontSize: 12, lineHeight: 1.5 }}>
            {text('Exporting — options are locked', '导出中，选项已锁定')}
        </p>
        <div id="progWrap" className={`progress${indeterminate ? ' indeterminate' : ''}`} style={{ display: scanning || determinateTask ? 'block' : 'none' }}
            role="progressbar" aria-label={text('Task progress', '任务进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : percent}>
            <div id="bar" className="bar" style={{ width: `${percent}%` }} />
        </div>
        <div id="progText" className="stat" role="status" aria-live="polite"
            style={{ display: feedback.kind === 'progress' ? 'block' : 'none', textAlign: 'center', minHeight: 20, lineHeight: 1.5, wordBreak: 'break-word', padding: '2px 0' }}>
            {feedback.kind === 'progress' ? message : ''}
        </div>
        <div id="taskStopControls" style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            <button id="btnCancel" className="ghost small" disabled={!exporting || task.phase !== 'running'}
                style={{ display: exporting ? 'inline-flex' : 'none', borderColor: 'var(--destructive-border, #5a2a2a)', color: 'var(--destructive-text, #f0a0a0)', margin: '0 auto' }}
                onClick={onCancel}>{exporting && task.phase === 'cancelling'
                    ? text('Cancelling…', '正在取消…') : exporting && task.phase === 'refreshing'
                        ? text('Refreshing history…', '正在刷新记录…') : text('Abort Export', '终止导出')}</button>
        </div>
        <p id="scanStatus" role="status" aria-live="polite" className="stat" hidden={scanMessage === null}
            data-sync-evidence={props.scanEvidence ? JSON.stringify(props.scanEvidence) : undefined}
            data-source-summary={props.sourceSummary ? JSON.stringify(props.sourceSummary) : undefined}
            style={{ margin: 0, textAlign: 'center', lineHeight: 1.5, overflowWrap: 'anywhere', padding: '2px 0' }}>{props.onTakeout && scanMessage?.includes('Takeout')
                ? <>{scanMessage.slice(0, scanMessage.indexOf('Takeout'))}<a href="#takeout" onClick={event => { event.preventDefault(); props.onTakeout?.(); }}>Takeout</a>{scanMessage.slice(scanMessage.indexOf('Takeout') + 7)}</>
                : scanMessage ?? ''}</p>
        <div id="scanSlowHint" className="stat" role="note" hidden={!scanSlow} style={{ textAlign: 'center', lineHeight: 1.5, overflowWrap: 'anywhere', color: 'var(--warn)', fontSize: 11 }}>
            {text('As conversation history grows, Gemini scans may take significantly longer.', '随着对话历史增加，Gemini 的扫描时间可能会显著变长。')}
        </div>
        <p id="status" role="status" aria-live="polite" className="stat" data-level={feedback.kind === 'status' ? feedback.level : undefined}
            style={{ display: showTask && feedback.kind === 'status' ? 'block' : 'none', margin: 0, textAlign: 'center', minHeight: 20, lineHeight: 1.5, overflowWrap: 'anywhere', padding: '2px 0' }}>{message}</p>
        {createPortal(<FailureCard {...props} />, failureHost)}
    </>;
}
