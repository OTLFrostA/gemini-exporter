// content_cred_bootstrap.js - CSP-safe credential bootstrap (no inline code)
// Relies on manifest world:MAIN public/hook-credentials.js for main capture
// Dynamic injection removed since it is handled by manifest world:MAIN

function extractAtFromPage() {
    try {
        // 1. global caches
        try {
            if (window.__gemExporterExtractedAt && typeof window.__gemExporterExtractedAt === 'string' && window.__gemExporterExtractedAt.length > 15) return window.__gemExporterExtractedAt;
            if (window.__geminiAt && typeof window.__geminiAt === 'string' && window.__geminiAt.length > 15) return window.__geminiAt;
        } catch {}
        // 2. WIZ global
        try {
            if (window._WIZ_global_data && window._WIZ_global_data.SNlM0e) return window._WIZ_global_data.SNlM0e;
            if (window.WIZ_global_data && window.WIZ_global_data.SNlM0e) return window.WIZ_global_data.SNlM0e;
            // sometimes __WIZ_global_data under window
            const w = window;
            if (w.__WIZ_global_data && w.__WIZ_global_data.SNlM0e) return w.__WIZ_global_data.SNlM0e;
        } catch {}
        // 3. scripts parse
        let scripts = document.querySelectorAll('script');
        for (let s of scripts) {
            let txt = s.textContent || '';
            if (!txt) continue;
            let m = txt.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
            if (m && m[1].length > 10) return m[1];
            let m2 = txt.match(/"at"\s*:\s*"([^"]{20,})"/);
            if (m2 && m2[1].length > 15 && m2[1].indexOf('%') === -1 && !m2[1].includes('\\')) return m2[1];
            // new pattern boq_ token sometimes in cfb2h?
            let m3 = txt.match(/"cfb2h"\s*:\s*"([^"]+)"/);
            if (m3 && m3[1].startsWith('A') && m3[1].length > 15) {
                // cfb2h is at token in some builds
                return m3[1];
            }
        }
        // 4. localStorage / sessionStorage guesses
        try {
            let ls = localStorage.getItem('SNlM0e') || sessionStorage.getItem('SNlM0e');
            if (ls) return ls;
            // gemini at sometimes stored under other keys, scan
            for (let i = 0; i < localStorage.length && i < 60; i++) {
                let k = localStorage.key(i);
                if (!k) continue;
                let v = localStorage.getItem(k) || '';
                if (v.length > 30 && v.length < 2000 && v.includes('AF')) {
                    let mm = v.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
                    if (mm) return mm[1];
                }
            }
        } catch {}
    } catch (e) {
        console.warn('extractAt fail', e);
    }
    return "";
}

function extractBlFromPage() {
    try {
        let scripts = document.querySelectorAll('script');
        for (let s of scripts) {
            let txt = s.textContent || '';
            if (!txt) continue;
            let m = txt.match(/"bl"\s*:\s*"([^"]+)"/);
            if (m && m[1] && m[1].startsWith('boq_')) return m[1];
            let m2 = txt.match(/boq_assistant-bard-web-server_[^"']+/);
            if (m2) return m2[0];
        }
        // document html fallback
        let html = document.documentElement.innerHTML || '';
        let m3 = html.match(/"bl":"(boq_[^"]+)"/);
        if (m3) return m3[1];
    } catch {}
    return "";
}

function detectSlotFromUrl(url) {
    try {
        let u = new URL(url || location.href);
        let m = u.pathname.match(/\/u\/(\d+)(?:\/|$)/);
        if (m) return `u${m[1]}`;
    } catch {}
    return "default";
}

function isExtAlive() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
        return false;
    }
}

async function ensureCreds() {
    if (!isExtAlive()) return null;
    try {
        let atFromPage = extractAtFromPage();
        let blFromPage = extractBlFromPage();
        if (blFromPage) {
            window.__gemExporterBl = blFromPage;
            try {
                localStorage.setItem('__gemExporterBl', blFromPage);
            } catch {}
        }
        if (atFromPage) {
            window.__gemExporterExtractedAt = atFromPage;
            try {
                window.__geminiAt = atFromPage;
            } catch {}
        }
        let mapObj = await chrome.storage.local.get(['gemini_credentials_map']);
        let map = mapObj.gemini_credentials_map || {};
        let vals = Object.values(map);
        if (atFromPage && vals.length === 0) {
            let slot = detectSlotFromUrl();
            let fakeSid = "page_sid_" + Date.now();
            map[fakeSid] = {
                at: atFromPage,
                sid: fakeSid,
                accountSlot: slot,
                lastUsed: Date.now(),
                bl: blFromPage || "boq_assistant-bard-web-server_20260202.09_p1"
            };
            await chrome.storage.local.set({
                gemini_credentials_map: map,
                gemini_credentials: {
                    at: atFromPage,
                    sid: fakeSid
                }
            });
            console.log('[Gemini Exporter] at fallback created fake sid', atFromPage.slice(0, 12) + '... bl ' + (blFromPage || 'fallback').slice(0, 20));
            return map[fakeSid];
        }
        if (atFromPage && vals.length > 0) {
            vals.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
            let best = vals[0];
            if (!best.at || best.at !== atFromPage) {
                best.at = atFromPage;
                best.lastUsed = Date.now();
                if (blFromPage) best.bl = blFromPage;
                map[best.sid || Object.keys(map)[0]] = best;
                await chrome.storage.local.set({
                    gemini_credentials_map: map,
                    gemini_credentials: {
                        at: best.at,
                        sid: best.sid
                    }
                });
                console.log('[Gemini Exporter] at refreshed from page', atFromPage.slice(0, 12));
            } else if (blFromPage && best.bl !== blFromPage) {
                best.bl = blFromPage;
                map[best.sid] = best;
                await chrome.storage.local.set({
                    gemini_credentials_map: map
                });
            }
        } else if (blFromPage && vals.length > 0) {
            vals.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
            let best = vals[0];
            if (best.bl !== blFromPage) {
                best.bl = blFromPage;
                map[best.sid] = best;
                await chrome.storage.local.set({
                    gemini_credentials_map: map
                });
                console.log('[Gemini Exporter] bl refreshed', blFromPage);
            }
        }
    } catch (e) {
        if (!String(e && e.message || e).includes('Extension context invalidated')) console.warn('ensureCreds fail', e);
    }
    return null;
}

// expose
try {
    window.__gemExporterExtractAt = extractAtFromPage;
    window.__gemExporterExtractBl = extractBlFromPage;
    window.__gemExporterEnsureCreds = ensureCreds;
} catch {}
ensureCreds();
window.addEventListener('load', () => {
    setTimeout(() => {
        ensureCreds();
    }, 1200);
    setTimeout(() => {
        ensureCreds();
    }, 3500);
});
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(ensureCreds, 600);
});

// 监听 GEMINI_CREDENTIALS
window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    if (e.data && e.data.type === 'GEMINI_CREDENTIALS') {
        if (!isExtAlive()) return;
        try {
            let p = e.data.payload || {};
            let sid = p.sid || "";
            if (!sid) return;
            let slot = p.accountSlot || detectSlotFromUrl(e.data.url || location.href) || "default";
            let store = await chrome.storage.local.get('gemini_credentials_map');
            let map = store.gemini_credentials_map || {};
            let old = map[sid] || {};
            map[sid] = {
                at: p.at || old.at || extractAtFromPage() || "",
                sid,
                accountSlot: slot || old.accountSlot || "default",
                lastUsed: Date.now(),
                bl: old.bl || extractBlFromPage() || "boq_assistant-bard-web-server_20260202.09_p1"
            };
            await chrome.storage.local.set({
                gemini_credentials_map: map,
                gemini_credentials: {
                    at: map[sid].at,
                    sid
                }
            });
            console.log('[Gemini Exporter] stored creds from MAIN hook', sid.slice(0, 8), slot, 'at len', (map[sid].at || '').length);
        } catch (err) {
            if (!String(err && err.message || err).includes('Extension context invalidated')) console.warn('creds store fail', err);
        }
    }
});