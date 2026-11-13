import type { Account } from '../../../l2/accountRegistry.js';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import { CLAUDE_SOURCE_EVENT, claudeRequest, claudeUuid } from './observation.js';
import { parseClaudeConversation } from '../../parsers/claude/parseConversation.js';
import { parseClaudeList } from '../../parsers/claude/parseList.js';
import { ingestContentIndexes, ingestContentDetail, ingestContentDeletedConversation } from '../../../runtime/api/contentDomainIngestion.js';

export interface ClaudeMessageBridgeCallbacks {
    isActive: () => boolean;
    currentAccount: () => Promise<(Account & { id: string }) | null>;
    onNativeDetailAccepted: (conversationId: string) => void;
    onSaveRequested: (key: ConversationKey, refreshDetail: boolean) => Promise<unknown>;
    registerCleanup: (cleanup: () => void) => void;
}

export function initClaudeMessageBridge(deps: ClaudeMessageBridgeCallbacks): void {
    let queue = Promise.resolve();
    const receive = (event: MessageEvent<unknown>) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (!data || typeof data !== 'object' || !('type' in data)
            || data.type !== CLAUDE_SOURCE_EVENT || !('payload' in data)) return;
        const raw = data.payload;
        queue = queue.catch(() => {}).then(async () => {
            if (!deps.isActive() || !raw || typeof raw !== 'object' || !('url' in raw) || typeof raw.url !== 'string'
                || !('method' in raw) || typeof raw.method !== 'string' || !('responseBody' in raw)
                || !('status' in raw) || typeof raw.status !== 'number' || raw.status < 200 || raw.status >= 300) return;
            const request = claudeRequest(raw.url, raw.method);
            const account = await deps.currentAccount();
            if (!request || !account || account.providerAccountId !== request.organization) return;
            if (request.kind === 'list') {
                const parsed = parseClaudeList(raw.responseBody && typeof raw.responseBody === 'object' && 'data' in raw.responseBody ? raw.responseBody.data : raw.responseBody);
                await ingestContentIndexes(account.id, parsed.conversations.map(item => ({ conversationId: item.id,
                    fields: { ...(item.title ? { title: item.title, titleSource: 'provider' as const } : {}),
                        ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}), updatedAt: item.updatedAt } })));
                return;
            }
            const cid = request.conversationId;
            if (!cid) return;
            if (request.kind === 'delete') {
                await ingestContentDeletedConversation(account.id, cid);
                return;
            }
            if (request.kind === 'detail') {
                const parsed = parseClaudeConversation(raw.responseBody, cid);
                const admission = await ingestContentDetail(account.id, cid, parsed.conversation.detail, parsed.conversation.index);
                if (!admission.accepted) return;
                deps.onNativeDetailAccepted(cid);
            }
            await deps.onSaveRequested({ accountId: account.id, conversationId: cid }, request.kind === 'stream');
        }).catch(error => console.warn('[Claude capture]', error));
    };
    window.addEventListener('message', receive);
    deps.registerCleanup(() => window.removeEventListener('message', receive));

    // Initial history can be server-rendered, without a list request. Visible links
    // prove only these index rows; they do not establish time ordering or Coverage.
    let sidebarTimer: ReturnType<typeof setTimeout> | undefined;
    let sidebarSignature = '';
    const captureSidebar = async () => {
        const rows = [...document.querySelectorAll<HTMLAnchorElement>('a[data-row-main-button][href*="/chat/"],nav a[href*="/chat/"],aside a[href*="/chat/"]')]
            .map(a => ({ id: new URL(a.href).pathname.split('/chat/')[1], title: a.textContent?.trim() }))
            .filter((row): row is { id: string; title: string } => claudeUuid(row.id) && !!row.title);
        const signature = JSON.stringify(rows);
        if (!rows.length || signature === sidebarSignature) return;
        const account = await deps.currentAccount();
        if (!account || !deps.isActive()) return;
        await ingestContentIndexes(account.id, [...new Map(rows.map(row => [row.id, row])).values()].map(row => ({
            conversationId: row.id, fields: { title: row.title, titleSource: 'provider' as const },
        })));
        sidebarSignature = signature;
    };
    const observer = new MutationObserver(() => {
        clearTimeout(sidebarTimer);
        sidebarTimer = setTimeout(() => { void captureSidebar().catch(console.warn); }, 500);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    void captureSidebar().catch(console.warn);
    deps.registerCleanup(() => { observer.disconnect(); clearTimeout(sidebarTimer); });
}
