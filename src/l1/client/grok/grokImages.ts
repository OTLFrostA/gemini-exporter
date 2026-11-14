import { queryAuthorizedPlatformTabIds } from '../tabSourceRunner.js';
import { grokUuid } from '../../parsers/grok/source.js';

/** Trusted shape assembled by our isolated-world DOM collector. */
export interface GrokCapturedImage {
    responseId: string;
    original_src: string;
    format: string;
    source: 'user_upload' | 'ai_generated';
}

/** Loominary's image selectors, with exact response ownership and account checks. */
export async function readGrokImages(conversationId: string, owner: string): Promise<GrokCapturedImage[]> {
    if (!grokUuid(conversationId) || !grokUuid(owner)) throw new TypeError('Invalid Grok image context');
    const tabIds = await queryAuthorizedPlatformTabIds('grok');
    const perTabResponses = await Promise.all(
        tabIds.map(tabId =>
            chrome.scripting.executeScript({
                target: { tabId },
                world: 'ISOLATED',
                func: async (conversation: string, account: string) => {
                    if (location.pathname !== '/c/' + conversation) return [];
                    const CACHE_KEY = '__gemExporterGrokUserCache';
                    const TTL_MS = 10_000;
                    const verify = async (forceRefresh: boolean): Promise<boolean> => {
                        const cookieNow = document.cookie;
                        if (!forceRefresh && cookieNow) {
                            const raw: unknown = Reflect.get(globalThis, CACHE_KEY);
                            if (raw && typeof raw === 'object') {
                                const cachedCookie: unknown = Reflect.get(raw, 'cookie');
                                const verifiedAt: unknown = Reflect.get(raw, 'verifiedAt');
                                const cachedUserId: unknown = Reflect.get(raw, 'userId');
                                if (cachedCookie === cookieNow && typeof verifiedAt === 'number'
                                    && Date.now() - verifiedAt < TTL_MS && typeof cachedUserId === 'string') {
                                    return cachedUserId === account;
                                }
                            }
                        }
                        const r = await fetch('/rest/auth/get-user', { credentials: 'include' });
                        const user: unknown = r.ok ? await r.json() : null;
                        if (!user || typeof user !== 'object' || !('userId' in user) || typeof user.userId !== 'string') {
                            return false;
                        }
                        if (document.cookie) {
                            Reflect.set(globalThis, CACHE_KEY, { cookie: document.cookie, verifiedAt: Date.now(), userId: user.userId });
                        }
                        return user.userId === account;
                    };
                    const cookieBefore = document.cookie;
                    if (!await verify(false)) return [];
                    const rows: GrokCapturedImage[] = [];
                    const seen = new Set<string>();
                    const images = document.querySelectorAll<HTMLImageElement>(
                        '[id^="response-"] img[src*="assets.grok.com"][src*="/generated/"],[data-testid="image-viewer"] img[src*="assets.grok.com"],figure img[src*="assets.grok.com"][src*="preview-image"]');
                    for (const img of images) {
                        if (img.parentElement?.style.filter.includes('blur')) continue;
                        const responseId = img.closest('[id^="response-"]')?.id.slice('response-'.length);
                        if (!responseId || !/^[\da-f-]{36}$/i.test(responseId)) continue;
                        const uri = new URL(img.src);
                        if (uri.origin !== 'https://assets.grok.com') continue;
                        const uploaded = !!img.closest('figure') && uri.pathname.includes('/preview-image');
                        const original = uploaded ? uri.href.split('/preview-image')[0] : uri.href;
                        const key = responseId + ':' + original;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        rows.push({ responseId, original_src: original, format: 'image/' + (/\.png(?:\?|$)/i.test(original) ? 'png' : /\.webp(?:\?|$)/i.test(original) ? 'webp' : 'jpeg'),
                            source: uploaded ? 'user_upload' : 'ai_generated' });
                    }
                    const cookieChanged = !cookieBefore || document.cookie !== cookieBefore;
                    const stillAuthorized = !cookieChanged || await verify(true);
                    return stillAuthorized && location.pathname === '/c/' + conversation ? rows : [];
                },
                args: [conversationId, owner],
            }).catch(() => []),
        ),
    );
    const results: GrokCapturedImage[] = [];
    for (const response of perTabResponses) {
        for (const entry of response) {
            if (Array.isArray(entry.result)) results.push(...entry.result);
        }
    }
    return results;
}
