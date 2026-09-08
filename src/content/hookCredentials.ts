// src/content/hookCredentials.ts - MAIN world, captures Gemini credentials safely (no inline)
import '../core/protocol/protocol.js';

(() => {
    if (typeof window === 'undefined') return;

    // Protocol anti-corruption layer: globalThis / window fallback
    const Proto = typeof GeminiProtocol !== 'undefined' ? GeminiProtocol : ((window as any).GeminiProtocol || null);
    if (!Proto) {
        console.error('[HookCred] GeminiProtocol missing — check manifest content_scripts load order');
        return;
    }

    const origFetch = window.fetch;
    const origOpen = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) ? XMLHttpRequest.prototype.open : null;
    const origSend = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) ? XMLHttpRequest.prototype.send : null;

    function isDev(): boolean {
        return typeof window !== 'undefined' && !!(window as any).__gemExporterDevMode;
    }

    function captureFromUrl(url: any, body: any): void {
        try {
            if (!url) return;
            const u = url.toString();
            if (!u.includes('batchexecute')) return;
            // Extract at, f.sid, bl
            let atMatch = u.match(/[?&]at=([^&]+)/) || (body && typeof body === 'string' && body.match(/at=([^&]+)/));
            const sidMatch = u.match(/[?&]f\.sid=([^&]+)/) || u.match(/f\.sid=([^&]+)/);
            const blMatch = u.match(/[?&]bl=([^&]+)/);
            // Also from body if URLSearchParams
            if (body && typeof body === 'string') {
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
                // Infer account slot from URL path /u/1/
                let slot = 'default';
                const m = u.match(/\/u\/(\d+)\//);
                if (m) slot = 'u' + m[1];
                else {
                    const m2 = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
                    if (m2) slot = 'u' + m2[1];
                }
                const payload = {
                    at: atMatch ? decodeURIComponent(atMatch[1]) : '',
                    sid: sidMatch ? decodeURIComponent(sidMatch[1]) : '',
                    bl: blMatch ? decodeURIComponent(blMatch[1]) : '',
                    accountSlot: slot,
                    lastUsed: Date.now(),
                    url: location.href
                };
                window.postMessage({
                    type: 'GEMINI_CREDENTIALS',
                    payload
                }, location.origin);
            }
        } catch (e) {
            if (isDev()) console.debug('[GemExporter:hook]', e);
        }
    }

    function detectDeletedConversation(url: any, body: any, responseText: any): void {
        try {
            const hasGz = (body && typeof body === 'string' && body.includes(Proto.RPCS.DELETE)) ||
                          (responseText && typeof responseText === 'string' && responseText.includes(Proto.RPCS.DELETE));
            if (!hasGz) return;

            let slot = 'default';
            const uStr = (url || '').toString();
            const m = uStr.match(/\/u\/(\d+)\//);
            if (m) slot = 'u' + m[1];
            else {
                const m2 = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
                if (m2) slot = 'u' + m2[1];
            }

            let targetText = (body || '') + ' ' + (responseText || '');
            try {
                if (targetText.includes('%')) {
                    targetText = decodeURIComponent(targetText);
                }
            } catch {
                /* intentional: invalid date or URI fallback */
            }

            // Anchor specifically to the delete-RPC payload parameter context to prevent false positives
            const idMatch = targetText.match(Proto.DELETION_ANCHORS[0]) ||
                            targetText.match(Proto.DELETION_ANCHORS[1]);
            if (idMatch && idMatch[1]) {
                const deletedId = idMatch[1];
                window.postMessage({
                    type: 'GEMINI_CONVERSATION_DELETED',
                    payload: { id: deletedId, slot }
                }, location.origin);
            }
        } catch (e) {
            if (isDev()) console.debug('[GemExporter:hook]', e);
        }
    }

    function broadcastBatchexecute(url: any, text: any): void {
        try {
            // wrb.fr is the outer wrapper of EVERY batchexecute response, so it must
            // not take part in this test — including it makes the filter always pass
            // and relays every response body (up to 3MB) across worlds. Only the
            // payloads the ISOLATED side actually parses (list / detail) are relayed.
            if (!text || (!text.includes(Proto.RPCS.LIST) && !text.includes(Proto.RPCS.DETAIL))) return;
            let slot = 'default';
            const uStr = (url || '').toString();
            const m = uStr.match(/\/u\/(\d+)\//);
            if (m) slot = 'u' + m[1];
            else {
                const m2 = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
                if (m2) slot = 'u' + m2[1];
            }
            window.postMessage({
                type: 'GEMINI_NETWORK_BATCHEXECUTE',
                payload: {
                    text: text.slice(0, 3000000), // Protect against memory spikes
                    slot,
                    url: uStr
                }
            }, location.origin);
        } catch (e) {
            if (isDev()) console.debug('[GemExporter:hook]', e);
        }
    }

    // Hook Fetch
    if (origFetch) {
        window.fetch = async function(...args: any[]) {
            try {
                const url = args[0];
                const init = args[1] || {};
                const body = init.body || (args[0] && args[0].body);
                captureFromUrl(url, body);
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
            }

            const response = await origFetch.apply(this, args as any);

            try {
                const url = args[0];
                const init = args[1] || {};
                const body = init.body || (args[0] && args[0].body);
                const u = (url || '').toString();
                if (u.includes('batchexecute')) {
                    const cloned = response.clone();
                    cloned.text().then((txt: string) => {
                        try {
                            detectDeletedConversation(url, body, txt);
                            broadcastBatchexecute(url, txt);
                        } catch (e) {
                            if (isDev()) console.debug('[GemExporter:hook]', e);
                        }
                    }).catch((e: any) => {
                        if (isDev()) console.debug('[GemExporter:hook]', e);
                    });
                }
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
            }

            return response;
        };
    }

    // Hook XHR
    if (origOpen && origSend) {
        XMLHttpRequest.prototype.open = function(...args: any[]) {
            try {
                (this as any).__hookUrl = args[1];
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
            }
            return origOpen.apply(this, args as any);
        };

        XMLHttpRequest.prototype.send = function(...args: any[]) {
            try {
                const url = (this as any).__hookUrl;
                const body = args[0];
                captureFromUrl(url, body);

                const u = (url || '').toString();
                if (u.includes('batchexecute')) {
                    this.addEventListener('load', () => {
                        try {
                            detectDeletedConversation(url, body, this.responseText);
                            broadcastBatchexecute(url, this.responseText);
                        } catch (e) {
                            if (isDev()) console.debug('[GemExporter:hook]', e);
                        }
                    });
                }
            } catch (e) {
                if (isDev()) console.debug('[GemExporter:hook]', e);
            }
            return origSend.apply(this, args as any);
        };
    }

    // Fallback: Scan DOM for IDs if needed
    function scanAndPostNetworkIds(text: string, source: string): void {
        try {
            if (!text) return;
            const matches = text.match(/c_[a-f0-9]{16}/g);
            if (matches && matches.length) {
                const uniqueIds = Array.from(new Set(matches.map(m => m.replace('c_', ''))));
                window.postMessage({
                    type: '__gemExporterNetworkIds',
                    ids: uniqueIds,
                    source
                }, location.origin);
            }
        } catch (e) {
            if (isDev()) console.debug('[GemExporter:hook]', e);
        }
    }

    if (isDev()) console.log('[Gemini Exporter] MAIN world credentials hook initialized');
})();
