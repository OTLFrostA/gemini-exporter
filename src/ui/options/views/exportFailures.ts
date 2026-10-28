import type { ConversationKey } from '../../../l2/conversationKey.js';
import type { ExportDiagnostic, ExportItemUpdate } from '../../../application/export/types.js';
import { text } from '../../shared/settings.js';

interface FailedConversation { key: ConversationKey; title?: string }
interface FailureGroup { diagnostic?: ExportDiagnostic; conversations: FailedConversation[] }

/** Group only reported failures, using exact diagnostic identity; never infer a cause from text. */
export function groupExportFailures(keys: readonly ConversationKey[], updates: readonly (ExportItemUpdate & { title?: string })[]): FailureGroup[] {
    const identity = (key: ConversationKey) => JSON.stringify([key.accountId, key.conversationId]);
    const failures = new Map(updates.flatMap(update => update.status === 'failed' ? [[identity(update.key), update] as const] : []));
    const groups = new Map<string, FailureGroup>();
    for (const key of new Map(keys.map(key => [identity(key), key])).values()) {
        const update = failures.get(identity(key));
        const diagnostic = update?.diagnostic;
        const signature = diagnostic ? JSON.stringify([diagnostic.stage, diagnostic.code, diagnostic.message]) : 'unknown';
        let group = groups.get(signature);
        if (!group) { group = { diagnostic, conversations: [] }; groups.set(signature, group); }
        group.conversations.push({ key, title: update?.title });
    }
    return [...groups.values()];
}

export function failureGroupLabel(group: FailureGroup): string {
    const count = group.conversations.length;
    return group.diagnostic && group.diagnostic.message !== 'Unknown error'
        ? text(`${count} conversations · same reported error`, `${count} 条会话 · 相同错误`)
        : text(`${count} conversations · Unknown error`, `${count} 条会话 · 未知错误`);
}

export function renderExportFailures(container: HTMLElement, groups: readonly FailureGroup[]): void {
    container.replaceChildren();
    for (const group of groups) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = failureGroupLabel(group);
        details.append(summary);
        if (group.diagnostic) {
            const diagnostic = document.createElement('div');
            diagnostic.style.overflowWrap = 'anywhere';
            diagnostic.textContent = `[${group.diagnostic.stage} / ${group.diagnostic.code}] ${group.diagnostic.message}`;
            details.append(diagnostic);
        }
        for (const { key, title } of group.conversations) {
            const line = document.createElement('div');
            line.textContent = title ? `${title} (${key.conversationId})` : key.conversationId;
            details.append(line);
        }
        container.append(details);
    }
}

export function copyExportFailures(groups: readonly FailureGroup[]): string {
    return groups.map(group => [failureGroupLabel(group),
        ...(group.diagnostic ? [`[${group.diagnostic.stage} / ${group.diagnostic.code}] ${group.diagnostic.message}`] : []),
        ...group.conversations.map(({ key, title }) => `${key.accountId}/${key.conversationId}${title ? `: ${title}` : ''}`)
    ].join('\n')).join('\n\n');
}
