import { getAccount } from '../core/api/accountRegistry.js';
import type { Account } from '../core/domain/accountRegistry.js';
import type { GeminiIndexObservationInput } from '../core/parsers/gemini/parseIndexObservation.js';
import type { ContentConversationDetail, DetailClient } from '../types/detailTransport.js';
import { resolveProvider } from '../core/provider/providerResolver.js';
import type { ApplicationProvider } from './providerCompatibility.js';
import { ingestConversation } from '../core/storage/conversationIngest.js';
import { resolveCurrentAccount, isCurrentAccount } from './accountContext.js';
import type { DomainConversationIndex } from '../core/domain/conversationIndex.js';
import { parseGeminiDomList } from '../core/parsers/gemini/dom/parseIndex.js';
import type { DomDetail, DetailFailure } from '../types/detailTransport.js';
import { parseGeminiDomConversation } from '../core/parsers/gemini/dom/parseConversation.js';
import { contentContext } from './contentContext.js';
import { getErrorMessage } from '../core/utils/utils.js';
import { isReservedRoute, normId } from '../core/utils/pathUtils.js';

export { isReservedRoute };

function cleanText(t?: string | null): string {
    return t ? t.replace(/\u00a0/g, ' ').replace(/\r/g, '').trim() : '';
}

export function parseDoc(doc: Document, id: string, url?: string, account?: Account): DomDetail;
export function parseDoc(doc: Document | null, id: string, url?: string, account?: Account): DomDetail | null;
export function parseDoc(doc: Document | null, id: string, url?: string, account?: Account): DomDetail | null {
    if (!doc) return null;
    if (!account) throw new TypeError('DOM parser requires an Account');
    const parsed = parseGeminiDomConversation({ document: doc, id, url }, { providerId: 'gemini', account });
    return parsed;
}

export async function contentFetchChatDetail(id: string, expectedAccountId?: string): Promise<DomDetail | DetailFailure> {
    const account = await resolveCurrentAccount();
    if (!account || expectedAccountId && expectedAccountId !== account.accountId) throw new Error('Requested account does not match this tab');
    const registered = await getAccount(account.accountId);
    if (!registered) throw new Error('Account no longer exists');
    const accept = (detail: DomDetail) => ingestConversation(account.accountId, detail, [], 'detail', () => isCurrentAccount(account)).then(accepted => ({ ...detail, ...accepted }));
    const url = `https://gemini.google.com/app/${id}`;
    let res: Response;
    try {
        res = await fetch(url, { credentials: 'include' });
    } catch (e: unknown) {
        return { id, title: id, error: 'fetch failed: ' + (getErrorMessage(e) || String(e)), _debug: { isNetworkError: true } };
    }
    if (!res.ok) {
        const isNotFound = res.status === 404;
        return {
            id,
            title: id,
            error: `HTTP ${res.status}`,
            isDeleted: isNotFound,
            _debug: { status: res.status, isNotFound }
        };
    }
    const html = await res.text();
    if (typeof DOMParser === 'undefined') {
        return { id, error: 'DOM parser unavailable', _debug: { htmlLen: html.length } };
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let parsed = parseDoc(doc, id, url, registered);
    if (!parsed.conversation.detail.messages.length) {
        try {
            const cleanId = normId(id);
            if (typeof location !== 'undefined' && (location.pathname.includes(cleanId) || location.href.includes(cleanId))) {
                const liveFallback = parseDoc(document, id, location.href, registered);
                if (liveFallback.conversation.detail.messages.length) {
                    console.log('[Gemini Exporter][DOM] live fallback success after fetch empty', id);
                    return accept(liveFallback);
                }
            }
        } catch {}
    }
    return accept(parsed);
}

/** L1 acquisition owns parsing and admission; callers receive only committed snapshots. */
export async function acquireCurrentConversation(cid: string, expectedAccountId?: string, options: {
    clientClass?: (new () => DetailClient) | null;
    scraper?: { parseDoc: (doc: Document | null, id: string, url?: string, account?: Account) => DomDetail | null };
} = {}): Promise<ContentConversationDetail | null> {
    const id = normId(cid);
    const account = await resolveCurrentAccount();
    if (!account || expectedAccountId && account.accountId !== expectedAccountId) return null;
    const accept = async (detail: ContentConversationDetail) => {
        const fresh = await resolveCurrentAccount();
        if (fresh?.accountId !== account.accountId || !isCurrentAccount(account)) throw new Error('Account changed during acquisition');
        return ingestConversation(account.accountId, detail, [], 'detail', () => isCurrentAccount(account));
    };
    const provider = Object.hasOwn(options, 'clientClass') ? null : resolveProvider();
    if (options.clientClass) {
        try {
            const detail = await new options.clientClass().getConversationDetail(id);
            if (detail?.conversation.detail.messages.length) return await accept(detail);
        } catch (error) { if (contentContext.isDevMode()) console.debug('[Gemini Exporter] client fallback', error); }
    } else if (provider?.id === 'gemini') {
        try {
            const detail = await (provider as ApplicationProvider).fetchConversationDetail(id, { accountId: account.accountId, slot: account.slot });
            if (detail?.conversation.detail.messages.length) return detail;
        } catch (error) { if (contentContext.isDevMode()) console.debug('[Gemini Exporter] provider fallback', error); }
    }
    const registered = await getAccount(account.accountId);
    if (!registered) throw new Error('Account no longer exists');
    const detail = (options.scraper ?? { parseDoc }).parseDoc(typeof document === 'undefined' ? null : document, id, undefined, registered);
    return detail?.conversation.detail.messages.length ? accept(detail) : null;
}

export function getScrollContainer(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    const selectors = [
        'chat-history-list',
        'div[data-test-id="chat-history-container"]',
        'nav[aria-label*="History"]',
        'nav[aria-label*="历史"]',
        'infinite-scroller',
        '.chat-history',
        'div.history-container'
    ];
    for (const s of selectors) {
        const el = document.querySelector<HTMLElement>(s);
        if (el) return el;
    }
    return null;
}

export function getConversationLinks(): GeminiIndexObservationInput[] {
    return typeof document === 'undefined' ? [] : parseGeminiDomList(document);
}

export function tryExpandRecents(): void {
    try {
        const btn = document.querySelector<HTMLElement>('button[aria-label="Toggle Recents"]') || document.querySelector<HTMLElement>('[aria-label="Toggle Recents"]');
        if (btn && btn.getAttribute('aria-expanded') === 'false') btn.click();
    } catch (e) {
        if (contentContext.isDevMode()) console.debug('[GemExporter:domScraper.ts]', e);
    }
}

export function debugCurrentPage(): any {
    try {
        const doc = document;
        const info: Record<string, any> = {
            title: doc.title,
            url: typeof location !== 'undefined' ? location.href : '',
            userQuery: doc.querySelectorAll('user-query').length,
            modelResponse: doc.querySelectorAll('model-response').length,
            altSelectors: {},
            htmlLen: doc.documentElement?.outerHTML?.length || 0,
            bodySnippet: (doc.body?.innerText || '').slice(0, 600)
        };
        const alts = ['[data-test-id*="user-query"]', '[data-test-id*="model-response"]', '[data-message-author-role]', 'div[role="article"]'];
        alts.forEach(s => {
            try { info.altSelectors[s] = doc.querySelectorAll(s).length; } catch (e) { if (contentContext.isDevMode()) console.debug('[GemExporter:domScraper.ts]', e); }
        });
        if (contentContext.isDevMode()) console.log('[Gemini Exporter][DOM Debug]', info);
        return info;
    } catch (e) {
        console.warn('debugCurrentPage fail', e);
        return null;
    }
}

export const DomScraper = {
    cleanText,
    parseDoc,
    contentFetchChatDetail,
    acquireCurrentConversation,
    getScrollContainer,
    isReservedRoute,
    getConversationLinks,
    tryExpandRecents,
    debugCurrentPage
};



export default DomScraper;
