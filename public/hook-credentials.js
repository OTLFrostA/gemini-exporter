// public/hook-credentials.js - MAIN world, captures Gemini credentials safely (no inline)
(function() {
    const origFetch = window.fetch;
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

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
                } catch {}
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
        } catch {}
    }

    window.fetch = function(input, init) {
        try {
            let url = typeof input === 'string' ? input : input.url;
            let body = init && init.body ? (typeof init.body === 'string' ? init.body : '') : '';
            captureFromUrl(url, body);
        } catch {}
        return origFetch.apply(this, arguments);
    };
    XMLHttpRequest.prototype.open = function(method, url) {
        this._gemini_url = url;
        return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function(body) {
        try {
            captureFromUrl(this._gemini_url, typeof body === 'string' ? body : '');
        } catch {}
        return origSend.apply(this, arguments);
    };

    // Also expose SNlM0e fallback for content script
    function broadcastAt() {
        try {
            let at = window.WIZ_global_data?.SNlM0e || window._WIZ_global_data?.SNlM0e || '';
            let bl = window.WIZ_global_data?.cfb2h || window._WIZ_global_data?.cfb2h || '';
            if (!at) {
                let scripts = document.querySelectorAll('script');
                for (let s of scripts) {
                    if (!s.textContent) continue;
                    let m = s.textContent.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
                    if (m) { at = m[1]; break; }
                }
            }
            if (at) {
                window.postMessage({
                    type: 'GEMINI_CREDENTIALS',
                    payload: {
                        at,
                        sid: '',
                        bl,
                        accountSlot: (location.pathname.match(/\/u\/(\d+)/)?.[1] ? 'u' + RegExp.$1 : 'default'),
                        lastUsed: Date.now(),
                        from: 'MAIN_WIZ'
                    }
                }, location.origin);
            }
        } catch {}
    }
    broadcastAt();
    setTimeout(broadcastAt, 400);
    setTimeout(broadcastAt, 1500);
    console.log('[HookCred] installed (no inline)');
})();