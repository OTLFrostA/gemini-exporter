// content_cred_bootstrap.js - Credential bootstrap
function extractAtFromPage() {
    try {
        try {
            if (window.__gemExporterExtractedAt && typeof window.__gemExporterExtractedAt === 'string' && window.__gemExporterExtractedAt.length > 15) return window.__gemExporterExtractedAt;
            if (window.__geminiAt && typeof window.__geminiAt === 'string' && window.__geminiAt.length > 15) return window.__geminiAt;
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:bootstrap.js]", e); }

        try {
            if (window._WIZ_global_data?.SNlM0e) return window._WIZ_global_data.SNlM0e;
            if (window.WIZ_global_data?.SNlM0e) return window.WIZ_global_data.SNlM0e;
            if (window.__WIZ_global_data?.SNlM0e) return window.__WIZ_global_data.SNlM0e;
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:bootstrap.js]", e); }

        let scripts = document.querySelectorAll('script');
        for (let s of scripts) {
            let txt = s.textContent || '';
            if (!txt) continue;
            let m = txt.match(/"SNlM0e"\s*:\s*"([^"]+)"/);
            if (m && m[1].length > 10) return m[1];
            let m2 = txt.match(/"at"\s*:\s*"([^"]{20,})"/);
            if (m2 && m2[1].length > 15 && !m2[1].includes('%') && !m2[1].includes('\\')) return m2[1];
            let m3 = txt.match(/"cfb2h"\s*:\s*"([^"]+)"/);
            if (m3 && m3[1].startsWith('A') && m3[1].length > 15) return m3[1];
        }

        try {
            let ls = localStorage.getItem('SNlM0e') || sessionStorage.getItem('SNlM0e');
            if (ls) return ls;
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:bootstrap.js]", e); }
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
    } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:bootstrap.js]", e); }
    return "";
}

function detectSlotFromUrl(url) {
    try {
        let u = new URL(url || location.href);
        let m = u.pathname.match(/\/u\/(\d+)(?:\/|$)/);
        if (m) return `u${m[1]}`;
    } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:bootstrap.js]", e); }
    return "default";
}

function isExtAlive() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch {
        return false;
    }
}

function getCredStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        if (chrome.storage.session) return chrome.storage.session;
        return chrome.storage.local;
    }
    return null;
}

async function loadCredentialsMap() {
    const storage = getCredStorage();
    if (!storage) return {};
    let mapObj = await storage.get(['gemini_credentials_map']);
    let map = mapObj.gemini_credentials_map || {};
    if (Object.keys(map).length === 0 && storage !== chrome.storage.local && chrome.storage.local) {
        try {
            const localObj = await chrome.storage.local.get(['gemini_credentials_map']);
            if (localObj && localObj.gemini_credentials_map) {
                map = localObj.gemini_credentials_map;
                await storage.set({ gemini_credentials_map: map });
                await chrome.storage.local.remove(['gemini_credentials_map', 'gemini_credentials']);
            }
        } catch { /* intentional: storage migration fallback */ }
    }
    return map;
}

async function saveCredentials(map, cred) {
    const storage = getCredStorage();
    if (!storage) return;
    const toSave = { gemini_credentials_map: map };
    if (cred) toSave.gemini_credentials = cred;
    await storage.set(toSave);
    if (storage !== chrome.storage.local && chrome.storage.local) {
        try {
            await chrome.storage.local.remove(['gemini_credentials_map', 'gemini_credentials']);
        } catch { /* intentional: local purge fallback */ }
    }
}

async function ensureCreds() {
    try {
        if (!isExtAlive()) return null;
        let atFromPage = extractAtFromPage();
        let blFromPage = extractBlFromPage();
        if (blFromPage) {
            window.__gemExporterExtractedBl = blFromPage;
            try {
                localStorage.setItem('__gemExporterBl', blFromPage);
            } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:bootstrap.js]", e); }
        }
        if (atFromPage) {
            window.__gemExporterExtractedAt = atFromPage;
            try {
                window.__geminiAt = atFromPage;
            } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:bootstrap.js]", e); }
        }
        let map = await loadCredentialsMap();
        let vals = Object.values(map);
        if (atFromPage && vals.length === 0) {
            let slot = detectSlotFromUrl();
            let fakeSid = "page_sid_" + Date.now();
            map[fakeSid] = {
                at: atFromPage,
                sid: fakeSid,
                accountSlot: slot,
                lastUsed: Date.now(),
                bl: blFromPage || "boq_assistant-bard-web-server_20260802.09_p1"
            };
            await saveCredentials(map, {
                at: atFromPage,
                sid: fakeSid
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
                await saveCredentials(map, {
                    at: best.at,
                    sid: best.sid
                });
                console.log('[Gemini Exporter] at refreshed from page', atFromPage.slice(0, 12));
            } else if (blFromPage && best.bl !== blFromPage) {
                best.bl = blFromPage;
                map[best.sid] = best;
                await saveCredentials(map);
            }
        } else if (blFromPage && vals.length > 0) {
            vals.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
            let best = vals[0];
            if (best.bl !== blFromPage) {
                best.bl = blFromPage;
                map[best.sid] = best;
                await saveCredentials(map);
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
} catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:bootstrap.js]", e); }
ensureCreds();
document.addEventListener('DOMContentLoaded', () => ensureCreds(), { once: true });
window.addEventListener('load', () => ensureCreds(), { once: true });

// 监听 GEMINI_CREDENTIALS - 仅接收同源 MAIN world 消息
window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    if (e.origin !== location.origin) return;
    if (e.data && e.data.type === 'GEMINI_CREDENTIALS') {
        if (!isExtAlive()) return;
        try {
            let p = e.data.payload || {};
            let sid = p.sid || "";
            if (!sid) return;
            let slot = p.accountSlot || detectSlotFromUrl(e.data.url || location.href) || "default";
            let map = await loadCredentialsMap();
            let old = map[sid] || {};
            map[sid] = {
                at: p.at || old.at || extractAtFromPage() || "",
                sid,
                accountSlot: slot || old.accountSlot || "default",
                lastUsed: Date.now(),
                bl: old.bl || extractBlFromPage() || "boq_assistant-bard-web-server_20260802.09_p1"
            };
            await saveCredentials(map, {
                at: map[sid].at,
                sid
            });
            console.log('[Gemini Exporter] stored creds from MAIN hook', sid.slice(0, 8), slot, 'at len', (map[sid].at || '').length);
        } catch (err) {
            if (!String(err && err.message || err).includes('Extension context invalidated')) console.warn('creds store fail', err);
        }
    }
});