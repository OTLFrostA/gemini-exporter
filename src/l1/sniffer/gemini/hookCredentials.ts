import type { Account } from '../../../l2/accountRegistry.js';
import { sniffUserProfileFromDom } from '../../parsers/gemini/dom/accountSniffer.js';
import { geminiAccountObservation } from '../../client/gemini/accountObservation.js';
import { GeminiProtocol, CrossWorldEvents } from '../../protocol/gemini/protocol.js';
import type { GeminiProtocolModule } from '../../protocol/gemini/protocol.js';
import type { GeminiCredentialsPayload } from '../../protocol/gemini/events.js';
import { createGeminiResponseRouter } from './responses/router.js';

declare global {
    interface Window {
        GeminiProtocol?: GeminiProtocolModule;
        __geminiIsStreaming?: boolean;
        __geminiLastStreamStart?: number;
        __geminiActiveStreamConvId?: string;
        __geminiLastStreamComplete?: number;
        __gemExporterHookInstalled?: boolean;
    }
    interface XMLHttpRequest {
        __hookUrl?: string | URL;
    }
}

(() => {
    if (typeof window === 'undefined' || window.__gemExporterHookInstalled) return;

    const rawProto: GeminiProtocolModule | undefined = GeminiProtocol || window.GeminiProtocol;
    if (!rawProto) {
        console.error('[HookCred] GeminiProtocol missing — check manifest content_scripts load order');
        return;
    }
    window.__gemExporterHookInstalled = true;
    const Proto: GeminiProtocolModule = rawProto;
    const Events = Proto.EVENTS || CrossWorldEvents;

    // MAIN-world discovery can read Wiz globals; the isolated content script cannot.
    // Discovery is independent of whether Gemini has sent a credential-bearing RPC.
    let publishedAccount: string | undefined;
    const publishAccount = (requestId?: string) => {
        const observation = geminiAccountObservation(sniffUserProfileFromDom());
        const slot = getSlotFromUrl(location.href);
        const signature = JSON.stringify([slot, observation]);
        if (requestId === undefined && signature === publishedAccount) return;
        if (requestId === undefined) publishedAccount = signature;
        window.postMessage({ type: Events.ACCOUNT_OBSERVED,
            payload: { observation, slot, ...(requestId ? { requestId } : {}) } }, location.origin);
    };
    publishAccount();
    document.addEventListener('DOMContentLoaded', () => publishAccount(), { once: true });
    window.addEventListener('load', () => publishAccount(), { once: true });
    window.addEventListener('pageshow', () => publishAccount());
    window.addEventListener('popstate', () => publishAccount());
    // WIZ can change without navigation or a credential-bearing request.
    // Publish only changed stable identity/profile evidence, including loss of Gaia.
    window.setInterval(() => publishAccount(), 1000);
    window.addEventListener('message', (event: MessageEvent) => {
        const raw: unknown = event.data;
        if (event.source !== window || event.origin !== location.origin || !raw || typeof raw !== 'object'
            || !('type' in raw) || raw.type !== Events.ACCOUNT_REQUESTED || !('payload' in raw)
            || !raw.payload || typeof raw.payload !== 'object' || !('requestId' in raw.payload)) return;
        const requestId: unknown = raw.payload.requestId;
        if (typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 128) publishAccount(requestId);
    });

    const routeResponse = createGeminiResponseRouter();
    const origFetch = window.fetch;
    const origOpen = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) ? XMLHttpRequest.prototype.open : null;
    const origSend = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) ? XMLHttpRequest.prototype.send : null;

    function isDev(): boolean {
        return Boolean(window.__gemExporterDevMode);
    }

    function toUrlString(url: string | URL | Request | null | undefined): string {
        if (!url) return '';
        const raw = typeof url === 'string' ? url
            : typeof Request !== 'undefined' && url instanceof Request ? url.url : url.toString();
        try { return new URL(raw, location.href).href; } catch { return raw; }
    }

    function captureFromUrl(url: string | URL | Request | null | undefined, body?: unknown): void {
        try {
            if (!url) return;
            const u = toUrlString(url);
            if (!u.includes('batchexecute')) return;
            publishAccount();
            let at = u.match(/[?&]at=([^&]+)/)?.[1] ?? null;
            if (!at && typeof body === 'string') {
                at = body.match(/at=([^&]+)/)?.[1] ?? null;
            }
            const sidMatch = u.match(/[?&]f\.sid=([^&]+)/) || u.match(/f\.sid=([^&]+)/);
            const blMatch = u.match(/[?&]bl=([^&]+)/);
            if (typeof body === 'string') {
                try {
                    const params = new URLSearchParams(body);
                    if (!at) at = params.get('at');
                } catch (e) {
                    if (isDev()) console.debug('[GemExporter:hook]', e);
                }
            }
            if (at || sidMatch) {
                const slot = getSlotFromUrl(u);
                const payload: GeminiCredentialsPayload = {
                    at: at ? decodeURIComponent(at) : '',
                    sid: sidMatch ? decodeURIComponent(sidMatch[1]) : '',
                    bl: blMatch ? decodeURIComponent(blMatch[1]) : '',
                    accountSlot: slot,
                    accountObservation: slot === getSlotFromUrl(location.href) ? geminiAccountObservation(sniffUserProfileFromDom()) ?? undefined : undefined,
                    lastUsed: Date.now(),
                    url: location.href
                };
                // broadcast, not a private channel; targetOrigin is locked to page origin.
                window.postMessage({
                    type: Events.CREDENTIALS,
                    payload
                }, location.origin);
            }
        } catch (e) {
            if (isDev()) console.debug('[GemExporter:hook]', e);
        }
    }

    function getSlotFromUrl(url: string | URL | Request | null | undefined): string {
        let slot = 'u0';
        const uStr = toUrlString(url);
        const m = uStr.match(/\/u\/(\d+)\//);
        if (m && m[1]) slot = 'u' + m[1];
        else {
            const m2 = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
            if (m2 && m2[1]) slot = 'u' + m2[1];
        }
        return slot;
    }

    // Capture request ownership without decoding endpoint response semantics.
    function captureRequestAccount(url: string): Omit<Account, 'id'> | null {
        if (getSlotFromUrl(url) !== getSlotFromUrl(location.href)) return null;
        return geminiAccountObservation(sniffUserProfileFromDom());
    }

    async function readCappedText(response: Response, cap: number): Promise<{ text: string; truncated: boolean }> {
        const body = response.body;
        if (body) {
            const reader = body.getReader();
            const chunks: Uint8Array[] = [];
            let received = 0;
            let truncated = false;
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value && value.length) {
                        const room = cap - received;
                        if (room <= 0) { truncated = true; break; }
                        if (value.length > room) {
                            chunks.push(value.slice(0, room));
                            received += room;
                            truncated = true;
                            break;
                        }
                        chunks.push(value);
                        received += value.length;
                    }
                }
            } finally {
                try {
                    if (truncated) void reader.cancel().catch(() => {});
                } catch { /* best effort */ }
                try { reader.releaseLock(); } catch { /* best effort */ }
            }
            const merged = new Uint8Array(received);
            let off = 0;
            for (const c of chunks) { merged.set(c, off); off += c.length; }
            const decoded = new TextDecoder().decode(merged);
            return { text: decoded, truncated };
        }
        const txt = await response.text();
        return txt.length > cap ? { text: txt.slice(0, cap), truncated: true } : { text: txt, truncated: false };
    }

    if (origFetch) {
        const nativeFetch = origFetch;
        window.fetch = async function(
            this: unknown,
            input: RequestInfo | URL,
            init?: RequestInit
        ): Promise<Response> {
            const requestedAt = Date.now();
            const url = toUrlString(input);
            const endpoint = routeResponse(url);
            const handler = endpoint?.({ url, slot: getSlotFromUrl(input), pagePath: location.pathname,
                requestedAt, requestAccountObservation: captureRequestAccount(url) });
            let requestBody: unknown;
            if (typeof Request !== 'undefined' && input instanceof Request) {
                requestBody = input.body;
            } else if (typeof input === 'object' && input !== null && 'body' in input) {
                requestBody = input.body;
            }
            const body: unknown = (init && init.body) || requestBody;
            let capturedBody = Promise.resolve(typeof body === 'string' ? body
                : body instanceof URLSearchParams ? body.toString() : '');
            if (typeof body !== 'string' && typeof Request !== 'undefined' && input instanceof Request
                && handler) {
                try { capturedBody = input.clone().text().catch(() => ''); } catch { /* metadata unavailable */ }
            }

            try {
                captureFromUrl(input, body);
                handler?.start(typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '');
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
            }

            let response: Response;
            try { response = await nativeFetch.call(this, input, init); }
            catch (error) {
                handler?.end();
                throw error;
            }

            if (handler) {
                const selected = handler;
                try {
                    void readCappedText(response.clone(), selected.captureLimit).then(async ({ text, truncated }) => {
                        const aborted = init?.signal?.aborted
                            || (typeof Request !== 'undefined' && input instanceof Request && input.signal.aborted);
                        selected.complete(await capturedBody, text, truncated || !!aborted, response.ok);
                    }).catch((error: unknown) => {
                        if (isDev()) console.debug('[GemExporter:hook]', error);
                    }).finally(() => selected.end());
                } catch { selected.end(); }
            }

            return response;
        };
    }

    if (origOpen && origSend) {
        const nativeOpen = origOpen;
        const nativeSend = origSend;

        type XhrOpenArgs =
            | [method: string, url: string | URL]
            | [method: string, url: string | URL, async: boolean, username?: string | null, password?: string | null];
        const hookedOpen = function(this: XMLHttpRequest, ...args: XhrOpenArgs): void {
            try {
                this.__hookUrl = args[1];
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
            }
            Reflect.apply(nativeOpen, this, args);
        };
        XMLHttpRequest.prototype.open = hookedOpen;

        XMLHttpRequest.prototype.send = function(this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>): void {
            let cancelStream = () => {};
            try {
                const url = this.__hookUrl;
                const body = args[0];
                const requestedAt = Date.now();
                const sourceUrl = toUrlString(url);
                const endpoint = routeResponse(sourceUrl);
                const handler = endpoint?.({ url: sourceUrl, slot: getSlotFromUrl(url), pagePath: location.pathname,
                    requestedAt, requestAccountObservation: captureRequestAccount(sourceUrl) });
                captureFromUrl(url, body);
                if (handler) {
                    const selected = handler;
                    const requestBody = typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '';
                    selected.start(requestBody);
                    let ended = false;
                    const handleEnd = (event: Event) => {
                        if (ended) return;
                        ended = true;
                        for (const name of ['load', 'loadend', 'abort', 'error', 'timeout']) this.removeEventListener(name, handleEnd);
                        try {
                            if (event.type === 'load') {
                                const text = this.responseText;
                                selected.complete(requestBody, text.slice(0, selected.captureLimit), text.length > selected.captureLimit,
                                    this.status >= 200 && this.status < 300);
                            }
                        } catch (error) { if (isDev()) console.debug('[GemExporter:hook]', error); }
                        finally { selected.end(); }
                    };
                    for (const name of ['load', 'loadend', 'abort', 'error', 'timeout']) this.addEventListener(name, handleEnd);
                    cancelStream = () => handleEnd(new Event('error'));
                }
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
            }
            try { nativeSend.apply(this, args); }
            catch (error) { cancelStream(); throw error; }
        };
    }

    if (isDev()) console.log('[Gemini Exporter] MAIN world credentials hook initialized');

})();

export {};
