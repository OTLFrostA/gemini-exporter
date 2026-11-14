import { text } from './settings.js';

export interface ConversationSourceSummary {
    method: 'sync' | 'takeout' | 'openai';
    status: 'running' | 'complete' | 'partial' | 'aborted' | 'error';
    read: number;
    added?: number;
    updated?: number;
}

/** All acquisition routes report source reads, committed additions and the current account's total. */
export function conversationSourceSummary(summary: ConversationSourceSummary, total: number): string {
    const method = summary.method === 'sync' ? text('Sync', '在线同步')
        : summary.method === 'takeout' ? text('Takeout import', 'Takeout 导入') : text('OpenAI ZIP import', 'OpenAI ZIP 导入');
    const status = {
        running: text('in progress', '进行中'), complete: text('complete', '完成'),
        partial: text('partially completed', '部分完成'), aborted: text('stopped', '已停止'), error: text('failed', '失败'),
    }[summary.status];
    const counts = [summary.method === 'sync'
        ? text(`Scanned: ${summary.read}`, `累计扫描 ${summary.read} 条对话`)
        : text(`Read: ${summary.read}`, `读取 ${summary.read} 条对话`)];
    if (summary.added !== undefined) counts.push(text(`Added: ${summary.added}`, `新增 ${summary.added} 条`));
    if (summary.updated !== undefined) counts.push(text(`Updated: ${summary.updated}`, `更新 ${summary.updated} 条信息`));
    counts.push(text(`Total conversations: ${total}`, `当前共 ${total} 条对话`));
    return [`${method}${text(' ', '')}${status}`, ...counts].join(' · ');
}
