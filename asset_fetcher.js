// asset_fetcher.js - In-page authenticated blob and asset fetching handler
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AssetFetcher = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function toHighRes(url, variant = "s1024-rj") {
        try {
            if (!url) return url;
            if (url.includes('/gg/')) {
                return url.includes('?') ? (url.includes('alr=yes') ? url : url + '&alr=yes') : url + '?alr=yes';
            }
            let [base, q = ""] = url.split("?");
            let stripped = base.replace(/=s\d+(?:-[a-z0-9]+)*/i, "");
            let suffix = q ? q + "&alr=yes" : "alr=yes";
            return stripped + "=" + variant + "?" + suffix;
        } catch {
            return url;
        }
    }

    function toDataUrl(blob) {
        return new Promise((res, rej) => {
            let fr = new FileReader();
            fr.onloadend = () => res(String(fr.result || ""));
            fr.onerror = () => rej(fr.error || new Error("read fail"));
            fr.readAsDataURL(blob);
        });
    }

    function extractLh3(text) {
        let m = text.match(/https:\/\/lh3\.google(?:usercontent)?\.com\/[^\s"'<>\\]+/i);
        return m ? m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&') : null;
    }

    function extractGucUrl(text) {
        let m = text.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*download[^\s"'<>]*/i);
        if (m) return m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
        let m2 = text.match(/https:\/\/lh3\.google(?:usercontent)?\.com\/[^\s"'<>\\]+/i);
        return m2 ? m2[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&') : null;
    }

    async function handleGetFileBlob(msg, sendResponse) {
        try {
            let candidates = [];
            if (msg.candidates && Array.isArray(msg.candidates)) candidates.push(...msg.candidates);
            if (msg.url) candidates.unshift(msg.url);

            try {
                let links = document.querySelectorAll('a[href*="googleusercontent"], a[href*="drive.google"], a[download]');
                for (let a of links) {
                    let href = a.href || a.getAttribute('href') || "";
                    let txt = (a.textContent || a.getAttribute('aria-label') || "").trim();
                    if (!href) continue;
                    if (msg.fileName && (txt.includes(msg.fileName) || href.includes(encodeURIComponent(msg.fileName)))) candidates.push(href);
                    else if (href.includes('googleusercontent') && href.includes('download')) candidates.push(href);
                }
            } catch {}

            try {
                let html = document.documentElement.innerHTML || "";
                let m = html.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*download[^\s"'<>]*/i);
                if (m) candidates.push(m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'));
            } catch {}

            candidates = [...new Set(candidates.filter(Boolean))];
            if (!candidates.length) {
                sendResponse({
                    success: false,
                    error: 'no file candidates (need Gemini page with login)'
                });
                return;
            }

            let seen = new Set();
            let queue = [...candidates];
            let reasons = [];

            while (queue.length) {
                let u = queue.shift();
                if (!u || seen.has(u)) continue;
                seen.add(u);
                try {
                    let resp = await fetch(u, {
                        credentials: 'include',
                        headers: { 'Accept': '*/*' }
                    });
                    if (!resp.ok) {
                        reasons.push(`HTTP ${resp.status}`);
                        continue;
                    }
                    let ct = (resp.headers.get('content-type') || '').toLowerCase();
                    if (ct.startsWith('text/html')) {
                        let txt = await resp.text();
                        if (txt.includes('accounts.google.com') || txt.includes('Sign in') || txt.includes('登录')) {
                            reasons.push('login redirect');
                            continue;
                        }
                        if (txt.includes('This content isn') || txt.includes('not available') || txt.includes('Error 404') || txt.includes('Unable to load') || txt.includes('发生错误') || txt.includes('无法访问')) {
                            reasons.push('google error page');
                            continue;
                        }
                        let inner = extractGucUrl(txt);
                        if (inner && !seen.has(inner)) {
                            queue.push(inner);
                            continue;
                        }
                        if (txt.length < 5000) {
                            reasons.push('html<5k');
                            continue;
                        }
                        if (msg.fileName && /\.html?$/i.test(msg.fileName)) {
                            let blob = new Blob([txt], { type: 'text/html' });
                            let dataUrl = await toDataUrl(blob);
                            sendResponse({
                                success: true,
                                blobBase64: dataUrl.split(',')[1],
                                mime: 'text/html',
                                size: blob.size,
                                finalUrl: resp.url || u,
                                contentType: 'text/html'
                            });
                            return;
                        }
                        reasons.push('html no file');
                        continue;
                    }
                    if (ct.startsWith('text/plain')) {
                        let txt = await resp.text();
                        let trimmed = txt.trim();
                        if (trimmed.startsWith('https://') && trimmed.length < 3000 && trimmed.includes('googleusercontent')) {
                            if (!seen.has(trimmed)) queue.push(trimmed);
                            continue;
                        }
                        if (trimmed.startsWith('http') && trimmed.length < 2000) continue;
                        let blob = new Blob([txt], { type: ct || 'text/plain' });
                        let dataUrl = await toDataUrl(blob);
                        sendResponse({
                            success: true,
                            blobBase64: dataUrl.split(',')[1],
                            mime: ct || 'text/plain',
                            size: blob.size,
                            finalUrl: resp.url || u,
                            contentType: ct
                        });
                        return;
                    }
                    let blob = await resp.blob();
                    if (blob.size < 10) {
                        reasons.push('blob<10');
                        continue;
                    }
                    if (blob.size < 400) {
                        try {
                            let txt = await blob.text();
                            if (txt.trim().startsWith('http')) {
                                reasons.push('blob is redirect text');
                                continue;
                            }
                        } catch {}
                    }
                    let dataUrl = await toDataUrl(blob);
                    sendResponse({
                        success: true,
                        blobBase64: dataUrl.split(',')[1],
                        mime: blob.type || ct,
                        size: blob.size,
                        finalUrl: resp.url || u,
                        contentType: ct || blob.type
                    });
                    return;
                } catch (e) {
                    reasons.push('fetch exception');
                    continue;
                }
            }

            sendResponse({
                success: false,
                error: 'all file candidates failed tried=' + seen.size + ' (' + reasons.slice(0, 3).join(', ') + ')',
                tried: Array.from(seen).slice(0, 4)
            });
        } catch (e) {
            sendResponse({
                success: false,
                error: e.message
            });
        }
    }

    async function handleGetImageBlob(msg, sendResponse) {
        try {
            let candidates = msg.candidates && Array.isArray(msg.candidates) ? msg.candidates.slice() : [msg.url, toHighRes(msg.url)].filter(Boolean);
            if (msg.url && msg.url.includes('/gg/')) {
                let withAlr = msg.url.includes('?') ? (msg.url.includes('alr=yes') ? msg.url : msg.url + '&alr=yes') : msg.url + '?alr=yes';
                candidates.push(withAlr);
            }
            let seen = new Set();
            let queue = [...new Set(candidates)];
            while (queue.length) {
                let u = queue.shift();
                if (!u || seen.has(u)) continue;
                seen.add(u);
                try {
                    let r = await fetch(u, {
                        credentials: 'include',
                        headers: { 'Accept': 'image/*,*/*;q=0.8' }
                    });
                    if (!r.ok) continue;
                    let ct = r.headers.get('content-type') || "";
                    if (ct.startsWith('image/')) {
                        let blob = await r.blob();
                        let dataUrl = await toDataUrl(blob);
                        sendResponse({
                            success: true,
                            blobBase64: dataUrl.split(',')[1],
                            mime: blob.type,
                            size: blob.size,
                            finalUrl: r.url || u,
                            contentType: ct
                        });
                        return;
                    }
                    if (ct.startsWith('text/plain') || ct.startsWith('text/html')) {
                        let txt = await r.text();
                        let inner = extractLh3(txt);
                        if (inner && !seen.has(inner)) {
                            queue.push(inner);
                            if (!inner.includes('alr=yes')) {
                                let innerAlr = inner.includes('?') ? inner + '&alr=yes' : inner + '?alr=yes';
                                if (!seen.has(innerAlr)) queue.push(innerAlr);
                            }
                        } else if (txt.includes('googleusercontent')) {
                            let m2 = txt.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*/i);
                            if (m2 && !seen.has(m2[0])) {
                                queue.push(m2[0]);
                                if (!m2[0].includes('alr=yes')) {
                                    let m2Alr = m2[0].includes('?') ? m2[0] + '&alr=yes' : m2[0] + '?alr=yes';
                                    if (!seen.has(m2Alr)) queue.push(m2Alr);
                                }
                            }
                        }
                        continue;
                    }
                    let blob = await r.blob();
                    if (blob.size > 800) {
                        let dataUrl = await toDataUrl(blob);
                        sendResponse({
                            success: true,
                            blobBase64: dataUrl.split(',')[1],
                            mime: blob.type || ct,
                            size: blob.size,
                            finalUrl: r.url || u
                        });
                        return;
                    }
                } catch (e) {
                    continue;
                }
            }
            sendResponse({
                success: false,
                error: 'all candidates failed ' + seen.size + ' tried',
                tried: Array.from(seen).slice(0, 4)
            });
        } catch (e) {
            sendResponse({
                success: false,
                error: e.message
            });
        }
    }

    async function downloadAssetDirect(msg, sendResponse) {
        try {
            const url = msg.url;
            if (!url) {
                sendResponse({ success: false, error: 'no url' });
                return;
            }
            try {
                const r = await fetch(url, {
                    credentials: 'include',
                    headers: { 'Accept': '*/*' }
                });
                if (r.ok) {
                    const ct = (r.headers.get('content-type') || '').toLowerCase();
                    const blob = await r.blob();
                    if (blob.size > 0 && (!ct.startsWith('text/html') || blob.size > 2000)) {
                        const dataUrl = await toDataUrl(blob);
                        sendResponse({
                            success: true,
                            dataBase64: dataUrl.split(',')[1],
                            mime: blob.type,
                            size: blob.size
                        });
                        return;
                    }
                }
            } catch (e) {}

            handleGetImageBlob(msg, (res) => {
                if (res && res.success && res.blobBase64) {
                    sendResponse({
                        success: true,
                        dataBase64: res.blobBase64,
                        mime: res.mime,
                        size: res.size
                    });
                } else {
                    handleGetFileBlob(msg, sendResponse);
                }
            });
        } catch (err) {
            sendResponse({ success: false, error: err.message });
        }
    }

    return {
        handleGetFileBlob,
        handleGetImageBlob,
        downloadAssetDirect,
        toHighRes,
        toDataUrl
    };
}));
