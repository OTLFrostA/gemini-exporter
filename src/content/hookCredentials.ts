import type { Account } from '../core/domain/accountRegistry.js';
import { sniffUserProfileFromDom } from './accountSniffer.js';
import { geminiAccountObservation } from '../core/provider/gemini/accountObservation.js';
import { readGeminiDetailRequest } from '../core/parsers/gemini/rpc/detailRequest.js';
import { readGeminiListRequest } from '../core/parsers/gemini/rpc/listRequest.js';
import { GeminiProtocol, CrossWorldEvents } from '../core/protocol/protocol.js';
import type { GeminiProtocolModule } from '../core/protocol/protocol.js';
import type {
    GeminiCredentialsPayload,
    GeminiConversationDeletedPayload,
    GeminiStreamStartPayload,
    GeminiStreamCompletePayload,
    GeminiNetworkBatchexecutePayload
} from '../core/protocol/events.js';

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

    const rawProto: GeminiProtocolModule | undefined =
        (typeof GeminiProtocol !== 'undefined' ? GeminiProtocol : undefined) ||
        (typeof window !== 'undefined' ? window.GeminiProtocol : undefined);
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

    const origFetch = window.fetch;
    const origOpen = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) ? XMLHttpRequest.prototype.open : null;
    const origSend = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) ? XMLHttpRequest.prototype.send : null;

    function isDev(): boolean {
        return typeof window !== 'undefined' && Boolean(window.__gemExporterDevMode);
    }

    function toUrlString(url: string | URL | Request | null | undefined): string {
        if (!url) return '';
        if (typeof url === 'string') return url;
        if (typeof Request !== 'undefined' && url instanceof Request) return url.url;
        return url.toString();
    }

    function captureFromUrl(url: string | URL | Request | null | undefined, body?: unknown): void {
        try {
            if (!url) return;
            const u = toUrlString(url);
            if (!u.includes('batchexecute')) return;
            publishAccount();
            let atMatch: RegExpMatchArray | [unknown, string] | null = u.match(/[?&]at=([^&]+)/);
            if (!atMatch && typeof body === 'string') {
                atMatch = body.match(/at=([^&]+)/);
            }
            const sidMatch = u.match(/[?&]f\.sid=([^&]+)/) || u.match(/f\.sid=([^&]+)/);
            const blMatch = u.match(/[?&]bl=([^&]+)/);
            if (typeof body === 'string') {
                try {
                    const params = new URLSearchParams(body);
                    if (!atMatch) {
                        const a = params.get('at');
                        if (a) atMatch = [null, a];
                    }
                } catch (e) {
                    if (isDev()) console.debug('[GemExporter:hook]', e);
                }
            }
            if (atMatch || sidMatch) {
                const slot = getSlotFromUrl(u);
                const payload: GeminiCredentialsPayload = {
                    at: atMatch ? decodeURIComponent(atMatch[1]) : '',
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

    function detectDeletedConversation(
        url: string | URL | Request | null | undefined,
        body: unknown,
        responseText: unknown,
        requestAccountObservation: Omit<Account, 'id'> | null
    ): void {
        try {
            const u = toUrlString(url);
            const bodyStr = body ? String(body) : '';
            const respStr = responseText ? String(responseText) : '';
            const hasGz = (bodyStr && bodyStr.includes(Proto.RPCS.DELETE)) ||
                          (respStr && respStr.includes(Proto.RPCS.DELETE)) ||
                          u.includes(Proto.RPCS.DELETE);
            if (!hasGz) return;

            const slot = getSlotFromUrl(url);

            let targetText = bodyStr + ' ' + respStr;
            try {
                if (targetText.includes('%')) {
                    targetText = decodeURIComponent(targetText);
                }
            } catch {
                /* intentional: invalid date or URI fallback */
            }

            // Anchor specifically to the delete-RPC payload parameter context to prevent false positives
            const anchor0 = Proto.DELETION_ANCHORS[0];
            const anchor1 = Proto.DELETION_ANCHORS[1];
            const idMatch = (anchor0 ? targetText.match(anchor0) : null) ||
                            (anchor1 ? targetText.match(anchor1) : null);
            if (idMatch && idMatch[1]) {
                const deletedId = idMatch[1];
                const payload: GeminiConversationDeletedPayload = { id: deletedId, slot, requestAccountObservation };
                window.postMessage({
                    type: Events.CONVERSATION_DELETED,
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
        else if (typeof location !== 'undefined') {
            const m2 = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
            if (m2 && m2[1]) slot = 'u' + m2[1];
        }
        return slot;
    }

    function isStreamUrl(url: string | URL | Request | null | undefined): boolean {
        try {
            const parsed = new URL(toUrlString(url), location.href);
            return parsed.protocol === 'https:' && parsed.hostname === 'gemini.google.com'
                && parsed.pathname.endsWith('/StreamGenerate');
        } catch { return false; }
    }

    // Observed Gemini wire signals: candidate[8][0] == 2 means answered;
    // inner[25] is the history-save marker. Require both, complete JSON frames and EOF.
    // No marker/unknown protocol/transport-only trailer is evidence of success.
    function completedTurn(text: string): { conversationId: string; responseId: string } | null {
        let identity: { conversationId: string; responseId: string } | null = null;
        let answered = false, saved = false;
        try {
            let expectedLength: number | undefined;
            for (const line of text.split('\n').map(value => value.trim()).filter(Boolean)) {
                if (line === ")]}'") continue;
                if (/^\d+$/.test(line)) {
                    if (expectedLength !== undefined) return null;
                    expectedLength = Number(line); continue;
                }
                if (expectedLength !== undefined && new TextEncoder().encode(line).length !== expectedLength) return null;
                expectedLength = undefined;
                const rows: unknown = JSON.parse(line);
                if (!Array.isArray(rows)) return null;
                for (const row of rows) {
                    if (!Array.isArray(row)) return null;
                    if (row[0] === 'er' || row[5] != null) return null;
                    if (row[0] !== 'wrb.fr') continue;
                    if (typeof row[2] !== 'string') return null;
                    const inner: unknown = JSON.parse(row[2]);
                    if (!Array.isArray(inner)) return null;
                    const metadata: unknown = inner[1];
                    if (Array.isArray(metadata) && typeof metadata[0] === 'string' && /^c_[a-f0-9]{8,64}$/i.test(metadata[0])
                        && typeof metadata[1] === 'string' && /^r_[a-f0-9]+$/i.test(metadata[1])) {
                        const next = { conversationId: metadata[0].slice(2), responseId: metadata[1] };
                        if (identity && (identity.conversationId !== next.conversationId || identity.responseId !== next.responseId)) return null;
                        identity = next;
                    }
                    if (Array.isArray(inner[4]) && inner[4].length) {
                        answered = inner[4].every((candidate: unknown) => Array.isArray(candidate)
                            && typeof candidate[0] === 'string' && candidate[0].startsWith('rc_')
                            && Array.isArray(candidate[8]) && candidate[8][0] === 2);
                    }
                    if (typeof inner[25] === 'string' && inner[25]) saved = true;
                }
            }
            return expectedLength === undefined && answered && saved ? identity : null;
        } catch { return null; }
    }
    let lastCompletedTurn: string | undefined;

    function extractConversationId(
        _url: string | URL | Request | null | undefined,
        body?: unknown,
        responseText?: unknown
    ): string | null {
        try {
            // 1. Check response text first (most authoritative for newly assigned conversation IDs in streaming chunk 1)
            if (typeof responseText === 'string') {
                const m = responseText.match(/["']c_([a-f0-9]{8,64})["']/i) || responseText.match(/c_([a-f0-9]{8,64})/i);
                if (m && m[1]) return m[1];
            }
            // 2. Check request body
            if (typeof body === 'string') {
                let decoded = body;
                try { decoded = decodeURIComponent(body); } catch {}
                const m = decoded.match(/["']c_([a-f0-9]{8,64})["']/i) || decoded.match(/c_([a-f0-9]{8,64})/i);
                if (m && m[1]) return m[1];
            }
            // 3. Check current window location
            if (typeof location !== 'undefined') {
                const m = location.pathname.match(/\/app\/([a-f0-9]{8,64})/i);
                if (m && m[1]) return m[1];
            }
        } catch (e) {
            if (isDev()) console.debug('[GemExporter:hook]', e);
        }
        return null;
    }

    function broadcastStreamStart(url: string | URL | Request | null | undefined, body?: unknown, requestAccountObservation: Omit<Account, 'id'> | null = null): void {
        try {
            const convId = extractConversationId(url, body);
            const slot = getSlotFromUrl(url);
            try {
                window.__geminiIsStreaming = true;
                window.__geminiLastStreamStart = Date.now();
                if (convId) window.__geminiActiveStreamConvId = convId;
            } catch {}
            const payload: GeminiStreamStartPayload = { id: convId, slot, requestAccountObservation };
            window.postMessage({
                type: Events.STREAM_START,
                payload
            }, location.origin);
        } catch (e) {
            if (isDev()) console.debug('[GemExporter:hook]', e);
        }
    }

    function broadcastStreamComplete(
        url: string | URL | Request | null | undefined,
        text: string,
        requestAccountObservation: Omit<Account, 'id'> | null,
        slot: string
    ): void {
        const turn = completedTurn(text);
        if (!turn) return;
        const identity = JSON.stringify([slot, requestAccountObservation?.providerAccountId, turn.conversationId, turn.responseId]);
        if (identity === lastCompletedTurn) return;
        lastCompletedTurn = identity;
        window.__geminiLastStreamComplete = Date.now();
        window.__geminiActiveStreamConvId = turn.conversationId;
        const payload: GeminiStreamCompletePayload = { id: turn.conversationId, requestAccountObservation, slot, url: toUrlString(url) };
        window.postMessage({ type: Events.STREAM_COMPLETE, payload }, location.origin);
    }

    // Capture before native send. A request for another slot has no verified current-page identity.
    function captureRequestAccount(url: string | URL | Request | null | undefined): Omit<Account, 'id'> | null {
        if ((!toUrlString(url).includes('batchexecute') && !isStreamUrl(url)) || getSlotFromUrl(url) !== getSlotFromUrl(location.href)) return null;
        return geminiAccountObservation(sniffUserProfileFromDom());
    }

    function broadcastBatchexecute(url: string | URL | Request | null | undefined, text: unknown, body?: unknown, truncated = false, requestedAt = 0, requestAccountObservation: Omit<Account, 'id'> | null = null, capturedSlot?: string): void {
        try {
            // wrb.fr is the outer wrapper of EVERY batchexecute response, so it must
            // not take part in this test — including it makes the filter always pass
            // and relays every response body (up to 3MB) across worlds. Only the
            // payloads the ISOLATED side actually parses (list / detail) are relayed.
            if (typeof text !== 'string' || (!text.includes(Proto.RPCS.LIST) && !text.includes(Proto.RPCS.DETAIL))) return;
            const slot = capturedSlot;
            if (!slot) return;
            const listRequest = readGeminiListRequest(body);
            const detailRequest = readGeminiDetailRequest(body);
            const payload: GeminiNetworkBatchexecutePayload = {
                text: text.slice(0, 3000000), // Protect against memory spikes
                ...(listRequest ? { listRequest } : {}),
                ...(detailRequest ? { detailRequest } : {}),
                requestedAt,
                requestAccountObservation,
                truncated: truncated || text.length > 3000000,
                slot,
                url: toUrlString(url)
            };
            window.postMessage({
                type: Events.NETWORK_BATCHEXECUTE,
                payload
            }, location.origin);
        } catch (e) {
            if (isDev()) console.debug('[GemExporter:hook]', e);
        }
    }

    const BATCHEXECUTE_SNIFF_CAP = 3 * 1024 * 1024;

    async function readCappedText(response: Response, cap: number = BATCHEXECUTE_SNIFF_CAP): Promise<{ text: string; truncated: boolean }> {
        const body = response.body;
        if (body && typeof body.getReader === 'function') {
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
                    if (truncated && typeof reader.cancel === 'function') void reader.cancel().catch(() => {});
                } catch { /* best effort */ }
                try { reader.releaseLock(); } catch { /* best effort */ }
            }
            const merged = new Uint8Array(received);
            let off = 0;
            for (const c of chunks) { merged.set(c, off); off += c.length; }
            const decoded = (typeof TextDecoder !== 'undefined')
                ? new TextDecoder().decode(merged)
                : String.fromCharCode.apply(null, Array.from(merged.slice(0, 65536)));
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
            const requestAccountObservation = captureRequestAccount(input);
            const requestSlot = getSlotFromUrl(input);
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
                && input.url.includes('batchexecute')) {
                try { capturedBody = input.clone().text().catch(() => ''); } catch { /* metadata unavailable */ }
            }

            try {
                captureFromUrl(input, body);
                if (isStreamUrl(input)) {
                    broadcastStreamStart(input, body, requestAccountObservation);
                }
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
            }

            let response: Response;
            try { response = await nativeFetch.call(this, input, init); }
            catch (error) {
                if (isStreamUrl(input)) window.__geminiIsStreaming = false;
                throw error;
            }

            try {
                const u = toUrlString(input);
                if (u.includes('batchexecute')) {
                    const cloned = response.clone();
                    readCappedText(cloned).then(async ({ text: txt, truncated }) => {
                        try {
                            detectDeletedConversation(input, await capturedBody, txt, requestAccountObservation);
                            broadcastBatchexecute(input, txt, await capturedBody, truncated || !response.ok, requestedAt, requestAccountObservation, requestSlot);
                        } catch (e) {
                            if (isDev()) console.debug('[GemExporter:hook]', e);
                        }
                    }).catch((e: unknown) => {
                        if (isDev()) console.debug('[GemExporter:hook]', e);
                    });
                } else if (isStreamUrl(input)) {
                    if (!response.ok) { window.__geminiIsStreaming = false; return response; }
                    try {
                        void readCappedText(response.clone()).then(({ text, truncated }) => {
                            if (!truncated && !(init?.signal?.aborted)
                                && !(typeof Request !== 'undefined' && input instanceof Request && input.signal.aborted)) {
                                broadcastStreamComplete(input, text, requestAccountObservation, requestSlot);
                            }
                        }).catch((error: unknown) => {
                            if (isDev()) console.debug('[GemExporter:hook]', error);
                        }).finally(() => { window.__geminiIsStreaming = false; });
                    } catch { window.__geminiIsStreaming = false; }
                }
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
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
                const requestAccountObservation = captureRequestAccount(url);
                const requestSlot = getSlotFromUrl(url);
                captureFromUrl(url, body);

                const u = toUrlString(url);
                if (u.includes('batchexecute')) {
                    this.addEventListener('load', () => {
                        try {
                            detectDeletedConversation(url, body, this.responseText, requestAccountObservation);
                            broadcastBatchexecute(url, this.responseText, body, this.status < 200 || this.status >= 300, requestedAt, requestAccountObservation, requestSlot);
                        } catch (e) {
                            if (isDev()) console.debug('[GemExporter:hook]', e);
                        }
                    });
                } else if (isStreamUrl(url)) {
                    broadcastStreamStart(url, body, requestAccountObservation);
                    let ended = false;
                    const cleanup = () => {
                        for (const event of ['load', 'loadend', 'abort', 'error', 'timeout']) this.removeEventListener(event, handleStreamEnd);
                    };
                    const handleStreamEnd = (event: Event) => {
                        if (ended) return;
                        ended = true;
                        cleanup();
                        window.__geminiIsStreaming = false;
                        if (event.type !== 'load' || this.status < 200 || this.status >= 300) return;
                        try {
                            if (this.responseText.length <= BATCHEXECUTE_SNIFF_CAP) {
                                broadcastStreamComplete(url, this.responseText, requestAccountObservation, requestSlot);
                            }
                        } catch (error) { if (isDev()) console.debug('[GemExporter:hook]', error); }
                    };
                    for (const event of ['load', 'loadend', 'abort', 'error', 'timeout']) this.addEventListener(event, handleStreamEnd);
                    cancelStream = () => handleStreamEnd(new Event('error'));
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
