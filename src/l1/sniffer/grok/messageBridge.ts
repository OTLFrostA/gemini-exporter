import type { Account } from '../../../l2/accountRegistry.js';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import { GROK_SOURCE_EVENT, grokRequest } from './observation.js';
import { grokUuid } from '../../parsers/grok/source.js';
import { parseGrokList } from '../../parsers/grok/parseList.js';
import { ingestContentIndexes, ingestContentDeletedConversation } from '../../../runtime/api/contentDomainIngestion.js';

export interface GrokMessageBridgeCallbacks {
    isActive: () => boolean;
    currentAccount: () => Promise<(Account & { id: string }) | null>;
    currentConversationId: () => string | null;
    isSaveEnabled: () => Promise<boolean>;
    onSaveRequested: (key: ConversationKey, refreshDetail: boolean) => Promise<unknown>;
    registerCleanup: (cleanup: () => void) => void;
}

export function initGrokMessageBridge(deps: GrokMessageBridgeCallbacks): { onRouteChanged: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let queue = Promise.resolve();
    const pending = new Map<string, string>();
    function scheduleSave(id: string, owner: string) {
        clearTimeout(timer);
        pending.set(id, owner);
        timer = setTimeout(() => {
            const ids = [...pending];
            pending.clear();
            queue = queue.catch(() => {}).then(async () => {
                for (const [cid, expectedOwner] of ids) {
                    if (!deps.isActive() || !await deps.isSaveEnabled()) continue;
                    const account = await deps.currentAccount();
                    if (deps.isActive() && account && account.providerAccountId === expectedOwner) {
                        await deps.onSaveRequested({ accountId: account.id, conversationId: cid }, true);
                    }
                }
            }).catch(error => console.warn('[Grok save]', error));
        }, 1000);
    }
    deps.registerCleanup(() => { clearTimeout(timer); pending.clear(); });

    const receive = (event: MessageEvent<unknown>) => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (!data || typeof data !== 'object' || !('type' in data)
            || data.type !== GROK_SOURCE_EVENT || !('payload' in data)) return;
        const raw = data.payload;
        queue = queue.catch(() => {}).then(async () => {
            if (!deps.isActive() || !raw || typeof raw !== 'object' || !('url' in raw) || typeof raw.url !== 'string'
                || !('method' in raw) || typeof raw.method !== 'string' || !('owner' in raw) || !grokUuid(raw.owner)
                || !('status' in raw) || typeof raw.status !== 'number' || raw.status < 200 || raw.status >= 300) return;
            const request = grokRequest(raw.url, raw.method);
            const account = await deps.currentAccount();
            if (!request || !account || account.providerAccountId !== raw.owner || !deps.isActive()) return;
            if (request.kind === 'list' && 'responseBody' in raw) {
                const parsed = parseGrokList(raw.responseBody);
                // Native filtered lists prove rows, never global Coverage.
                await ingestContentIndexes(account.id, parsed.conversations.map(row => ({ conversationId: row.id, fields: {
                    updatedAt: row.updatedAt, ...(row.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
                    ...(row.title ? { title: row.title, titleSource: 'provider' as const } : {}) } })));
            } else if (request.kind === 'delete' && request.conversationId) {
                pending.delete(request.conversationId);
                await ingestContentDeletedConversation(account.id, request.conversationId);
            } else if (request.conversationId) {
                scheduleSave(request.conversationId, raw.owner);
            }
        }).catch(error => console.warn('[Grok capture]', error));
    };
    window.addEventListener('message', receive);
    deps.registerCleanup(() => window.removeEventListener('message', receive));

    // Grok may deliver replies over a persistent transport without a fetch response.
    // DOM changes are only a wake-up signal: the provider still reads the native tree
    // and all message bodies, and rechecks account ownership before committing.
    let mutationTimer: ReturnType<typeof setTimeout> | undefined;
    let signature = '';
    const observer = new MutationObserver(records => {
        if (!records.some(record => {
            const target = record.target instanceof Element ? record.target : record.target.parentElement;
            return target && !target.closest('#geminiExportBadge,[contenteditable="true"],textarea');
        })) return;
        clearTimeout(mutationTimer);
        mutationTimer = setTimeout(() => {
            if (!deps.isActive()) return;
            const id = deps.currentConversationId();
            const next = id + ':' + [...document.querySelectorAll('[id^="response-"]')]
                .map(element => [element.textContent, [...element.querySelectorAll('img')].map(img => img.src).join(',')].join(':')).join('\n');
            if (!id || next === signature) return;
            signature = next;
            void deps.currentAccount().then(account => {
                if (deps.isActive() && account && deps.currentConversationId() === id) scheduleSave(id, account.providerAccountId);
            }).catch(console.warn);
        }, 1500);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    deps.registerCleanup(() => { observer.disconnect(); clearTimeout(mutationTimer); });

    return {
        onRouteChanged: () => {
            const id = deps.currentConversationId();
            if (id) void deps.currentAccount().then(account => {
                if (deps.isActive() && account && deps.currentConversationId() === id) scheduleSave(id, account.providerAccountId);
            }).catch(console.warn);
        },
    };
}
