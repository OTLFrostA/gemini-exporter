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
    const counts = text(`Read ${summary.read} conversation ${summary.read === 1 ? 'record' : 'records'}`,
        `已读取到 ${summary.read} 条会话记录`);
    const added = summary.added === undefined ? '' : text(`, added ${summary.added}`, `，新增 ${summary.added} 条`);
    return counts + added + text(`, total ${total}`, `，一共 ${total} 条`);
}
