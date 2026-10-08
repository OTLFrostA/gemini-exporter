import type { DomDetail } from '../types/detailTransport.js';
import { parseGeminiDomConversation } from '../core/parsers/gemini/dom/parseConversation.js';
import { createParsedConversationView } from '../core/compatibility/record/projectDomainRecord.js';
import { contentContext } from './contentContext.js';
import { cleanTitle, isRealTitle, getErrorMessage } from '../core/utils/utils.js';
import { isReservedRoute, normId } from '../core/utils/pathUtils.js';

export { isReservedRoute };

function cleanText(t?: string | null): string {
    return t ? t.replace(/\u00a0/g, ' ').replace(/\r/g, '').trim() : '';
}

export function parseDoc(doc: Document, id: string, url?: string): DomDetail;
export function parseDoc(doc: Document | null, id: string, url?: string): DomDetail | null;
export function parseDoc(doc: Document | null, id: string, url?: string): DomDetail | null {
    if (!doc) return null;
    const parsed = parseGeminiDomConversation({ document: doc, id, url }, { providerId: 'gemini' });
    return { ...createParsedConversationView(parsed), titleSource: parsed.conversation.titleSource === 'dom' ? 'dom' : 'default', _debug: parsed.transport };
}

export async function contentFetchChatDetail(id: string): Promise<DomDetail> {
    const url = `https://gemini.google.com/app/${id}`;
    let res: Response;
    try {
        res = await fetch(url, { credentials: 'include' });
    } catch (e: unknown) {
        return { id, title: id, messages: [], error: 'fetch failed: ' + (getErrorMessage(e) || String(e)), _debug: { isNetworkError: true } };
    }
    if (!res.ok) {
        const isNotFound = res.status === 404;
        return {
            id,
            title: id,
            messages: [],
            error: `HTTP ${res.status}`,
            isDeleted: isNotFound,
            _debug: { status: res.status, isNotFound }
        };
    }
    const html = await res.text();
    if (typeof DOMParser === 'undefined') {
        return { id, title: id, messages: [], _raw: { htmlLen: html.length } };
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let parsed = parseDoc(doc, id, url);
    if (!parsed.messages.length) {
        try {
            const cleanId = normId(id);
            if (typeof location !== 'undefined' && (location.pathname.includes(cleanId) || location.href.includes(cleanId))) {
                const liveFallback = parseDoc(document, id, location.href);
                if (liveFallback.messages.length) {
                    console.log('[Gemini Exporter][DOM] live fallback success after fetch empty', id);
                    return liveFallback;
                }
            }
        } catch {}
    }
    return parsed;
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
        const el = document.querySelector(s) as HTMLElement;
        if (el) return el;
    }
    return null;
}

export function getConversationLinks(): any[] {
    if (typeof document === 'undefined') return [];
    const items: any[] = [];
    const links = document.querySelectorAll('a[href*="/app/"]');
    for (const a of Array.from(links)) {
        const href = (a as HTMLAnchorElement).href || a.getAttribute('href') || '';
        const m = href.match(/\/app\/(c_)?([A-Za-z0-9_-]{8,})/);
        if (m) {
            const id = normId(m[2]);
            if (isReservedRoute(id)) continue;
            const rawTitle = (a.querySelector('.title, [class*="title"]')?.textContent || a.textContent || '').trim();
            const title = cleanTitle(rawTitle);
            const isReal = isRealTitle(title, id);
            const titlesObj: Record<string, string> = {};
            if (isReal) titlesObj.dom = title;
            items.push({
                id,
                title: isReal ? title : (contentContext.isZh() ? '未命名对话' : 'Untitled Chat'),
                titleSource: isReal ? 'dom' : 'default',
                titles: titlesObj,
                url: `https://gemini.google.com/app/${id}`,
                href: `https://gemini.google.com/app/${id}`
            });
        }
    }
    return items;
}

export function tryExpandRecents(): void {
    try {
        const btn = document.querySelector('button[aria-label="Toggle Recents"]') || document.querySelector('[aria-label="Toggle Recents"]');
        if (btn && (btn as HTMLElement).getAttribute('aria-expanded') === 'false') (btn as HTMLElement).click();
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
    getScrollContainer,
    isReservedRoute,
    getConversationLinks,
    tryExpandRecents,
    debugCurrentPage
};



export default DomScraper;
