// public/hook-credentials.js - MAIN world, captures Gemini credentials safely (no inline)
(function() {
    if (typeof window === 'undefined') return;
    // Protocol anti-corruption layer — must load before this script (manifest order).
    const Proto = window.GeminiProtocol;
    if (!Proto) {
        console.error('[HookCred] GeminiProtocol missing — check manifest content_scripts load order');
        return;
    }
    const origFetch = window.fetch;
    const origOpen = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) ? XMLHttpRequest.prototype.open : null;
    const origSend = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype) ? XMLHttpRequest.prototype.send : null;

    function captureFromUrl(url, body) {
        try {
            if (!url) return;
            let u = url.toString();
            if (!u.includes('batchexecute')) return;
            // Extract at, f.sid, bl
            let atMatch = u.match(/[?&]at=([^&]+)/) || (body && body.match && body.match(/at=([^&]+)/));
            let sidMatch = u.match(/[?&]f\.sid=([^&]+)/) || u.match(/f\.sid=([^&]+)/);
            let blMatch = u.match(/[?&]bl=([^&]+)/);
            // Also from body if URLSearchParams
            if (body) {
                try {
                    const params = new URLSearchParams(body);
                    if (!atMatch) {
                        let a = params.get('at');
                        if (a) atMatch = [null, a];
                    }
                } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
            }
            if (atMatch || sidMatch) {
                // Infer account slot from URL path /u/1/
                let slot = 'default';
                let m = u.match(/\/u\/(\d+)\//);
                if (m) slot = 'u' + m[1];
                else {
                    let m2 = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
                    if (m2) slot = 'u' + m2[1];
                }
                let payload = {
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
        } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
    }

    function detectDeletedConversation(url, body, responseText) {
        try {
            const hasGz = (body && typeof body === 'string' && body.includes(Proto.RPCS.DELETE)) ||
                          (responseText && typeof responseText === 'string' && responseText.includes(Proto.RPCS.DELETE));
            if (!hasGz) return;

            let slot = 'default';
            let uStr = (url || '').toString();
            let m = uStr.match(/\/u\/(\d+)\//);
            if (m) slot = 'u' + m[1];
            else {
                let m2 = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
                if (m2) slot = 'u' + m2[1];
            }

            let targetText = (body || '') + ' ' + (responseText || '');
            try {
                if (targetText.includes('%')) {
                    targetText = decodeURIComponent(targetText);
                }
            } catch { /* intentional: invalid date or URI fallback */ }

            // Anchor specifically to the delete-RPC payload parameter context to prevent false positives
            let idMatch = targetText.match(Proto.DELETION_ANCHORS[0]) ||
                          targetText.match(Proto.DELETION_ANCHORS[1]);
            if (idMatch && idMatch[1]) {
                const deletedId = idMatch[1];
                window.postMessage({
                    type: 'GEMINI_CONVERSATION_DELETED',
                    payload: { id: deletedId, slot }
                }, location.origin);
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
    }

    function broadcastBatchexecute(url, text) {
        try {
            if (!text || (!text.includes(Proto.RPCS.LIST) && !text.includes(Proto.RPCS.DETAIL) && !text.includes(Proto.RPCS.DELETE) && !text.includes(Proto.WRB))) return;
            let slot = 'default';
            let uStr = (url || '').toString();
            let m = uStr.match(/\/u\/(\d+)\//);
            if (m) slot = 'u' + m[1];
            else {
                let m2 = location.pathname.match(/\/u\/(\d+)(?:\/|$)/);
                if (m2) slot = 'u' + m2[1];
            }
            window.postMessage({
                type: 'GEMINI_NETWORK_BATCHEXECUTE',
                payload: { text, slot }
            }, location.origin);
        } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
    }

    if (origFetch) {
        window.fetch = function(input, init) {
            let url = '';
            try {
                url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
                let body = init && init.body ? (typeof init.body === 'string' ? init.body : '') : '';
                captureFromUrl(url, body);
                detectDeletedConversation(url, body, null);
            } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
            return origFetch.apply(this, arguments).then(function(response) {
                try {
                    if (url && url.toString().includes('batchexecute') && response && response.ok) {
                        let clone = response.clone();
                        clone.text().then(function(text) {
                            try {
                                broadcastBatchexecute(url, text);
                                detectDeletedConversation(url, null, text);
                            } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
                        }).catch(function(e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); });
                    }
                } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
                return response;
            });
        };
    }

    if (origOpen && origSend) {
        XMLHttpRequest.prototype.open = function(method, url) {
            try {
                this._gemini_url = url;
            } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
            return origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function(body) {
            try {
                const bodyStr = typeof body === 'string' ? body : '';
                captureFromUrl(this._gemini_url, bodyStr);
                detectDeletedConversation(this._gemini_url, bodyStr, null);
                if (this._gemini_url && this._gemini_url.toString().includes('batchexecute')) {
                    const reqUrl = this._gemini_url;
                    this.addEventListener('load', function() {
                        try {
                            let text = this.responseText;
                            broadcastBatchexecute(reqUrl, text);
                            detectDeletedConversation(reqUrl, null, text);
                        } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
                    });
                }
            } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
            return origSend.apply(this, arguments);
        };
    }

    // Also expose SNlM0e fallback for content script
    function broadcastAt() {
        try {
            let at = window.WIZ_global_data?.[Proto.TOKENS.AT] || window._WIZ_global_data?.[Proto.TOKENS.AT] || '';
            let bl = window.WIZ_global_data?.[Proto.TOKENS.BL] || window._WIZ_global_data?.[Proto.TOKENS.BL] || '';
            if (!at) {
                let scripts = document.querySelectorAll('script');
                for (let s of scripts) {
                    if (!s.textContent) continue;
                    let m = s.textContent.match(Proto.TOKEN_PATTERNS.atFromScript);
                    if (m) { at = m[1]; break; }
                }
            }
            if (at) {
                let slotMatch = location.pathname.match(/\/u\/(\d+)/);
                let slot = (slotMatch && slotMatch[1]) ? `u${slotMatch[1]}` : 'default';
                window.postMessage({
                    type: 'GEMINI_CREDENTIALS',
                    payload: {
                        at,
                        sid: '',
                        bl,
                        accountSlot: slot,
                        lastUsed: Date.now(),
                        from: 'MAIN_WIZ'
                    }
                }, location.origin);
            }
        } catch (e) { if (typeof window !== 'undefined' && window.__gemExporterDevMode) console.debug("[GemExporter:hook]", e); }
    }
    broadcastAt();
    setTimeout(broadcastAt, 400);
    setTimeout(broadcastAt, 1500);
    console.log('[HookCred] installed (no inline)');
})();