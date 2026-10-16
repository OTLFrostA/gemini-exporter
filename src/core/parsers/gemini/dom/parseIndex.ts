import type { DomainConversationIndex } from '../../../domain/conversationIndex.js';
import { parseGeminiIndexObservation } from '../parseIndexObservation.js';
import { normId, isReservedRoute } from '../../../utils/pathUtils.js';
import { cleanTitle, isRealTitle } from '../../../utils/titleUtils.js';

export function parseGeminiDomList(document: Document): DomainConversationIndex[] {
    const items: DomainConversationIndex[] = [];
    const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/app/"]');
    for (const a of Array.from(links)) {
        const href = a.href || a.getAttribute('href') || '';
        let path: string;
        try {
            const url = new URL(href, 'https://gemini.google.com');
            if (url.origin !== 'https://gemini.google.com') continue;
            path = url.pathname;
        } catch { continue; }
        const m = path.match(/^(?:\/u\/\d+)?\/app\/(c_)?([A-Za-z0-9_-]{8,})\/?$/);
        if (m) {
            const id = normId(m[2]);
            if (isReservedRoute(id)) continue;
            const rawTitle = (a.querySelector('.title, [class*="title"]')?.textContent || a.textContent || '').trim();
            items.push(parseGeminiIndexObservation({
                id,
                title: rawTitle,
                titleSource: 'dom',
                url: `https://gemini.google.com/app/${id}`
            }, 'dom'));
        }
    }
    return items;
}

function activeTitle(document: Document, activeId: string): { title: string; source: string } | null {
    const titleEls = document.querySelectorAll('[data-test-id="conversation-title"], .conversation-title');
    for (const el of Array.from(titleEls)) {
        // Sidebar titles belong to their link's conversation, not necessarily the active one.
        if (el.closest('a[href]')) continue;
        const t = cleanTitle(el.textContent || '');
        if (isRealTitle(t, activeId)) return { title: t, source: 'dom' };
    }
    // Match the complete conversation ID, rather than a substring in an unrelated link.
    for (const index of parseGeminiDomList(document)) {
        if (index.id === normId(activeId) && index.title) return { title: index.title, source: 'dom' };
    }
    const firstUserQuery = document.querySelector('user-query .query-text, user-query [data-test-id="query-text"], user-query p, user-query');
    if (firstUserQuery) {
        const t = cleanTitle((firstUserQuery.textContent || '').trim().slice(0, 60).replace(/\n+/g, ' '));
        if (isRealTitle(t, activeId)) return { title: t, source: 'sniff' };
    }
    return null;
}

/** Current page metadata -> Domain; DOM title precedence and message-count meaning stay here. */
export function parseGeminiDomIndex(document: Document | null, id: string): DomainConversationIndex {
    const title = document ? activeTitle(document, id) : null;
    const count = document?.querySelectorAll('user-query, model-response').length ?? 0;
    return parseGeminiIndexObservation({ id, ...(title ? { title: title.title, titleSource: title.source } : {}),
        ...(count > 0 ? { messageCount: count } : {}) }, 'dom');
}
