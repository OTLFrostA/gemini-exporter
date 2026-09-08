// src/content/assetFetcher.ts - In-page authenticated blob and asset fetching handler
import { contentContext } from './contentContext';

const MAX_BASE64_BLOB_SIZE = 50 * 1024 * 1024; // 超过50MB避免 FileReader base64 内存翻倍，交由 Takeout 兜底
const LARGE_FILE_WARN_SIZE = 30 * 1024 * 1024;

export function toHighRes(url: string, variant = 's1024-rj'): string {
    try {
        if (!url) return url;
        if (url.includes('/gg/')) {
            return url.includes('?') ? (url.includes('alr=yes') ? url : url + '&alr=yes') : url + '?alr=yes';
        }
        const [base, q = ''] = url.split('?');
        const stripped = base.replace(/=s\d+(?:-[a-z0-9]+)*/i, '');
        const suffix = q ? q + '&alr=yes' : 'alr=yes';
        return stripped + '=' + variant + '?' + suffix;
    } catch {
        return url;
    }
}

export function toDataUrl(blob: Blob): Promise<string> {
    if (typeof FileReader === 'undefined') {
        if (typeof Buffer !== 'undefined' && typeof (blob as any).arrayBuffer === 'function') {
            return (blob as any).arrayBuffer().then((buf: ArrayBuffer) => {
                const b64 = Buffer.from(buf).toString('base64');
                const type = blob.type || 'application/octet-stream';
                return `data:${type};base64,${b64}`;
            });
        }
    }
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onloadend = () => res(String(fr.result || ''));
        fr.onerror = () => rej(fr.error || new Error('read fail'));
        fr.readAsDataURL(blob);
    });
}

export function extractLh3(text: string): string | null {
    const m = text.match(/https:\/\/lh3\.google(?:usercontent)?\.com\/[^\s"'<>\\]+/i);
    return m ? m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&') : null;
}

export function extractGucUrl(text: string): string | null {
    const m = text.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*download[^\s"'<>]*/i);
    if (m) return m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
    const m2 = text.match(/https:\/\/lh3\.google(?:usercontent)?\.com\/[^\s"'<>\\]+/i);
    return m2 ? m2[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&') : null;
}

export async function handleGetFileBlob(msg: any, sendResponse: (resp: any) => void): Promise<void> {
    try {
        let candidates: string[] = [];
        if (msg.candidates && Array.isArray(msg.candidates)) candidates.push(...msg.candidates);
        if (msg.url) candidates.unshift(msg.url);

        try {
            if (typeof document !== 'undefined') {
                const links = document.querySelectorAll('a[href*="googleusercontent"], a[href*="drive.google"], a[download]');
                for (const a of Array.from(links)) {
                    const href = (a as HTMLAnchorElement).href || a.getAttribute('href') || '';
                    const txt = (a.textContent || a.getAttribute('aria-label') || '').trim();
                    if (!href) continue;
                    if (msg.fileName && (txt.includes(msg.fileName) || href.includes(encodeURIComponent(msg.fileName)))) candidates.push(href);
                    else if (href.includes('googleusercontent') && href.includes('download')) candidates.push(href);
                }
            }
        } catch (e) {
            if (contentContext.isDevMode()) console.debug('[GemExporter:assetFetcher.ts]', e);
        }

        try {
            if (typeof document !== 'undefined') {
                const html = document.documentElement?.innerHTML || '';
                const m = html.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*download[^\s"'<>]*/i);
                if (m) candidates.push(m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'));
            }
        } catch (e) {
            if (contentContext.isDevMode()) console.debug('[GemExporter:assetFetcher.ts]', e);
        }

        candidates = [...new Set(candidates.filter(Boolean))];
        if (!candidates.length) {
            sendResponse({
                success: false,
                error: 'no file candidates (need Gemini page with login)'
            });
            return;
        }

        const seen = new Set<string>();
        const queue = [...candidates];
        const reasons: string[] = [];

        while (queue.length) {
            const u = queue.shift();
            if (!u || seen.has(u)) continue;
            seen.add(u);

            try {
                const res = await fetch(u, { credentials: 'include' });
                if (!res.ok) {
                    reasons.push(`${u} -> HTTP ${res.status}`);
                    continue;
                }
                const blob = await res.blob();
                if (blob.size === 0) {
                    reasons.push(`${u} -> empty blob`);
                    continue;
                }
                const dataUrl = await toDataUrl(blob);
                sendResponse({
                    success: true,
                    dataUrl,
                    mimeType: blob.type || 'application/octet-stream',
                    size: blob.size,
                    url: u
                });
                return;
            } catch (err: any) {
                reasons.push(`${u} -> ${err?.message || err}`);
            }
        }

        sendResponse({
            success: false,
            error: 'All fetch candidates failed: ' + reasons.join('; ')
        });
    } catch (e: any) {
        sendResponse({
            success: false,
            error: 'fetchFileBlob fatal: ' + (e?.message || e)
        });
    }
}

export async function handleGetImageBlob(msg: any, sendResponse: (resp: any) => void): Promise<void> {
    try {
        const rawUrl = msg.url;
        if (!rawUrl) {
            sendResponse({ success: false, error: 'no url provided' });
            return;
        }

        const highResUrl = toHighRes(rawUrl);
        const urlsToTry = [highResUrl];
        if (highResUrl !== rawUrl) urlsToTry.push(rawUrl);

        let lastErr = '';
        for (const u of urlsToTry) {
            try {
                const res = await fetch(u, { credentials: 'include' });
                if (!res.ok) {
                    lastErr = `HTTP ${res.status}`;
                    continue;
                }
                const blob = await res.blob();
                if (!blob || blob.size === 0) {
                    lastErr = 'empty blob';
                    continue;
                }
                if (msg.preferBuffer !== false && typeof blob.arrayBuffer === 'function') {
                    try {
                        const dataBuffer = await blob.arrayBuffer();
                        sendResponse({
                            success: true,
                            dataBuffer,
                            blobBuffer: dataBuffer,
                            mime: blob.type || 'image/jpeg',
                            mimeType: blob.type || 'image/jpeg',
                            size: blob.size,
                            url: u
                        });
                        return;
                    } catch (e) {
                        if (contentContext.isDevMode()) console.debug('[GemExporter:assetFetcher.ts]', e);
                    }
                }
                const dataUrl = await toDataUrl(blob);
                sendResponse({
                    success: true,
                    dataUrl,
                    dataBase64: dataUrl.split(',')[1],
                    blobBase64: dataUrl.split(',')[1],
                    mime: blob.type || 'image/jpeg',
                    mimeType: blob.type || 'image/jpeg',
                    size: blob.size,
                    url: u
                });
                return;
            } catch (e: any) {
                lastErr = e?.message || String(e);
            }
        }

        sendResponse({
            success: false,
            error: 'Failed to fetch image: ' + lastErr
        });
    } catch (e: any) {
        sendResponse({
            success: false,
            error: 'handleGetImageBlob fatal: ' + (e?.message || e)
        });
    }
}

export async function downloadAssetDirect(msg: any, sendResponse: (resp: any) => void): Promise<void> {
    try {
        const url = msg.url;
        if (!url) {
            sendResponse({ success: false, error: 'no url' });
            return;
        }

        try {
            const r = await fetch(url, {
                credentials: 'include',
                headers: { Accept: '*/*' }
            });
            if (r.ok) {
                const ct = (r.headers.get('content-type') || '').toLowerCase();
                const blob = await r.blob();
                if (blob.size > MAX_BASE64_BLOB_SIZE) {
                    console.warn('[AssetFetcher] direct download too large, fallback', (blob.size / 1024 / 1024).toFixed(1) + 'MB');
                } else if (blob.size > 0 && (!ct.startsWith('text/html') || blob.size > 2000)) {
                    if (msg.preferBuffer !== false && typeof blob.arrayBuffer === 'function') {
                        try {
                            const dataBuffer = await blob.arrayBuffer();
                            sendResponse({
                                success: true,
                                dataBuffer: dataBuffer,
                                mime: blob.type || ct,
                                size: blob.size
                            });
                            return;
                        } catch (e) {
                            if (contentContext.isDevMode()) console.debug('[GemExporter:assetFetcher.ts]', e);
                        }
                    }
                    const dataUrl = await toDataUrl(blob);
                    sendResponse({
                        success: true,
                        dataBase64: dataUrl.split(',')[1],
                        mime: blob.type || ct,
                        size: blob.size
                    });
                    return;
                }
            }
        } catch (e) {
            if (contentContext.isDevMode()) console.debug('[GemExporter:assetFetcher.ts]', e);
        }

        handleGetImageBlob(msg, (res) => {
            if (res && res.success && (res.dataBuffer || res.blobBuffer || res.blobBase64)) {
                sendResponse({
                    success: true,
                    dataBuffer: res.dataBuffer || res.blobBuffer,
                    dataBase64: res.blobBase64,
                    mime: res.mime,
                    size: res.size
                });
            } else {
                handleGetFileBlob(msg, sendResponse);
            }
        });
    } catch (err: any) {
        sendResponse({ success: false, error: err?.message || String(err) });
    }
}

export const AssetFetcher = {
    toHighRes,
    toDataUrl,
    extractLh3,
    extractGucUrl,
    handleGetFileBlob,
    handleGetImageBlob,
    downloadAssetDirect
};


if (typeof module !== 'undefined' && (module as any).exports) (module as any).exports = AssetFetcher;
