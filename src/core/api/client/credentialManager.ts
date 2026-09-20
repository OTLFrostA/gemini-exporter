import GeminiProtocol, { GeminiProtocolModule } from "../../protocol/protocol.js";
import { detectSlotFromUrl } from "../../utils/pathUtils.js";
import { STORAGE_KEYS } from "../../utils/constants.js";
import { __resolveModule } from "../../utils/moduleOverrides.js";
import { getCredStorage } from "./credStorage.js";

export interface GeminiCredentials {
    sid: string;
    at: string;
    bl: string;
    accountSlot: string;
    lastUsed?: number;
}

export type GeminiCredentialsMap = Record<string, GeminiCredentials>;

export interface GeminiClientCredentialManagerModule {
    getBlFromPage: () => string | null;
    getAtFromPage: () => string;
    detectSlot: () => string | null;
    getCredStorage: () => any;
    loadCredMap: () => Promise<GeminiCredentialsMap>;
    resolveCred: (targetSidOrSlot?: string | null, overrides?: { at?: string; bl?: string; accountSlot?: string } | null) => Promise<GeminiCredentials>;
    generateFallbackSid: () => string;
}

function getProtocol(): GeminiProtocolModule {
    return __resolveModule('GeminiProtocol', GeminiProtocol);
}

    const generateFallbackSid = () => String(Math.floor(Math.random() * 1e19));

    let _blCache: { v: string | null; ts: number; len: number } | null = null;
    let _atCache: { v: string; ts: number; len: number } | null = null;
    const CRED_CACHE_TTL = 30000;

    // Page DOM credential extractor - accepts optional doc for decoupling and testing
    function getBlFromPage(doc?: any): string | null {
        try {
            const glob = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {}) as any;
            const targetDoc = doc || glob.document;
            if (!targetDoc) return null;
            const htmlLen = (targetDoc.documentElement && targetDoc.documentElement.innerHTML || "").length;
            if (_blCache && Date.now() - _blCache.ts < CRED_CACHE_TTL && _blCache.len === htmlLen) return _blCache.v;
            const P = getProtocol();
            let html = (targetDoc.documentElement && targetDoc.documentElement.innerHTML) || "";
            let m = html.match(P.TOKEN_PATTERNS.blCfb2hFromHtml) || html.match(P.TOKEN_PATTERNS.blAssistantFromHtml);
            let res: string | null = null;
            if (m) res = m[1];
            else if (glob.__gemExporterBl) res = glob.__gemExporterBl;
            _blCache = { v: res, ts: Date.now(), len: htmlLen };
            if (res) return res;
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:credentialManager.ts]", e); }
        return null;
    }

    // Page DOM credential extractor - accepts optional doc for decoupling and testing
    function getAtFromPage(doc?: any): string {
        try {
            const glob = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {}) as any;
            if (glob.__gemExporterExtractAt) {
                let a = glob.__gemExporterExtractAt();
                if (a) return a;
            }
            const targetDoc = doc || glob.document;
            if (!targetDoc) return "";
            const htmlLen = (targetDoc.documentElement && targetDoc.documentElement.innerHTML || "").length;
            if (_atCache && Date.now() - _atCache.ts < CRED_CACHE_TTL && _atCache.len === htmlLen) return _atCache.v;
            const P = getProtocol();
            if (glob._WIZ_global_data && glob._WIZ_global_data[P.TOKENS.AT]) {
                const v = glob._WIZ_global_data[P.TOKENS.AT];
                _atCache = { v, ts: Date.now(), len: htmlLen };
                return v;
            }
            if (glob.WIZ_global_data && glob.WIZ_global_data[P.TOKENS.AT]) {
                const v = glob.WIZ_global_data[P.TOKENS.AT];
                _atCache = { v, ts: Date.now(), len: htmlLen };
                return v;
            }
            let scripts = targetDoc.querySelectorAll ? targetDoc.querySelectorAll("script") : [];
            for (let s of scripts) {
                let txt = s.textContent || "";
                let m = txt.match(P.TOKEN_PATTERNS.atFromScript);
                if (m) {
                    _atCache = { v: m[1], ts: Date.now(), len: htmlLen };
                    return m[1];
                }
            }
            let html = (targetDoc.documentElement && targetDoc.documentElement.innerHTML) || "";
            let mHtml = html.match(P.TOKEN_PATTERNS.atFromScript);
            if (mHtml) {
                _atCache = { v: mHtml[1], ts: Date.now(), len: htmlLen };
                return mHtml[1];
            }
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:credentialManager.ts]", e); }
        return "";
    }

    function detectSlot(urlOrPath?: string): string | null {
        try {
            const glob = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {}) as any;
            const path = urlOrPath || (glob.location && glob.location.pathname) || "";
            const slot = detectSlotFromUrl(path);
            return slot === "u0" ? "default" : slot;
        } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:credentialManager.ts]", e); }
        return "default";
    }

    // getCredStorage is the shared resolver from ./credStorage.js (session
    // preferred, local fallback after a "not allowed" session failure).
    // It is re-exported below as part of the module surface.

    function normalizeLegacySingleCred(s: any, map: GeminiCredentialsMap): void {
        const legacy = s?.[STORAGE_KEYS.CREDENTIALS];
        if (legacy?.sid && !map[legacy.sid]) {
            map[legacy.sid] = {
                at: legacy.at || "",
                bl: legacy.bl || getProtocol().BL_FALLBACK,
                sid: legacy.sid,
                accountSlot: "default",
                lastUsed: Date.now()
            };
        }
    }

    async function loadCredMap(): Promise<GeminiCredentialsMap> {
        const storage = getCredStorage();
        if (!storage) return {};
        try {
            let s: any = await storage.get([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
            let map: GeminiCredentialsMap = s[STORAGE_KEYS.CREDENTIALS_MAP] || {};
            normalizeLegacySingleCred(s, map);
            if (Object.keys(map).length === 0 && typeof chrome !== "undefined" && storage !== chrome.storage.local && chrome.storage.local) {
                try {
                    let localS: any = await chrome.storage.local.get([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
                    let localMap: GeminiCredentialsMap = localS[STORAGE_KEYS.CREDENTIALS_MAP] || {};
                    normalizeLegacySingleCred(localS, localMap);
                    if (Object.keys(localMap).length > 0) {
                        map = localMap;
                        await storage.set({ [STORAGE_KEYS.CREDENTIALS_MAP]: map });
                        await chrome.storage.local.remove([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
                    }
                } catch { /* intentional: migration fallback */ }
            }
            return map;
        } catch {
            return {};
        }
    }

    async function resolveCred(
        targetSidOrSlot?: string | null,
        overrides?: { at?: string; bl?: string; accountSlot?: string } | null
    ): Promise<GeminiCredentials> {
        let map = await loadCredMap();
        let vals = Object.values(map);
        let pageAt = getAtFromPage();
        let pageBl = getBlFromPage();

        const normSlot = (s?: string | null) => (s === "u0" || !s ? "default" : s);

        // Detect if targetSidOrSlot is actually a slot or an email/accountId
        const isSlotParam = targetSidOrSlot && (
            /^u\d+$/i.test(targetSidOrSlot) ||
            targetSidOrSlot.includes('@') ||
            targetSidOrSlot === 'default'
        );
        const targetSid = (!isSlotParam && targetSidOrSlot && map[targetSidOrSlot]) ? targetSidOrSlot : null;
        const requestedSlot = overrides?.accountSlot || (isSlotParam ? targetSidOrSlot : null);

        if ((!vals.length || !vals[0].at) && pageAt) {
            let slot = requestedSlot || detectSlot() || "default";
            let sid = vals[0]?.sid || ("page_" + Date.now());
            let entry: GeminiCredentials = {
                sid,
                at: pageAt,
                bl: pageBl || getProtocol().BL_FALLBACK,
                accountSlot: slot,
                lastUsed: Date.now()
            };
            vals = [entry];
            try {
                const storage = getCredStorage();
                if (storage) {
                    map[sid] = entry;
                    await storage.set({
                        [STORAGE_KEYS.CREDENTIALS_MAP]: map,
                        [STORAGE_KEYS.CREDENTIALS]: {
                            at: pageAt,
                            sid
                        }
                    });
                    if (typeof chrome !== "undefined" && storage !== chrome.storage.local && chrome.storage.local) {
                        await chrome.storage.local.remove([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
                    }
                }
            } catch (e) { if (typeof console !== "undefined" && console.debug) console.debug("[GemExporter:credentialManager.ts]", e); }
        } else if (pageBl) {
            // Heal only the entry belonging to the requested slot or current tab's slot
            const curSlot = normSlot(requestedSlot || detectSlot());
            const target = vals.find(v => !v.bl && normSlot(v.accountSlot) === curSlot);
            if (target) {
                target.bl = pageBl;
                try {
                    const storage = getCredStorage();
                    if (storage) await storage.set({ gemini_credentials_map: map });
                } catch (e) { /* keep in-memory copy; retried on next resolveCred */ }
            }
        }

        let result: GeminiCredentials;
        if (targetSid && map[targetSid]) {
            result = {
                ...map[targetSid],
                bl: map[targetSid].bl || pageBl || getProtocol().BL_FALLBACK,
                at: map[targetSid].at || pageAt || ""
            };
        } else {
            let cur = normSlot(requestedSlot || detectSlot());
            let f = vals.filter(v => normSlot(v.accountSlot) === cur);
            // CRITICAL SECURITY FIX: Do NOT fall back to `vals` when `f` is empty!
            // Borrowing other accounts' credentials causes silent cross-account token pollution.
            let arr = f;
            arr.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
            if (arr[0]) {
                result = {
                    ...arr[0],
                    bl: arr[0].bl || pageBl || getProtocol().BL_FALLBACK,
                    at: arr[0].at || (cur === normSlot(detectSlot()) ? pageAt : "") || ""
                };
            } else {
                const isCurrentPageMatch = cur === normSlot(detectSlot());
                result = {
                    sid: generateFallbackSid(),
                    at: isCurrentPageMatch ? (pageAt || "") : "",
                    accountSlot: cur,
                    bl: pageBl || getProtocol().BL_FALLBACK
                };
            }
        }
        if (overrides) {
            if (overrides.at) result.at = overrides.at;
            if (overrides.bl) result.bl = overrides.bl;
            if (overrides.accountSlot) result.accountSlot = overrides.accountSlot;
        }
        return result;
    }

export {
    getBlFromPage,
    getAtFromPage,
    detectSlot,
    getCredStorage,
    loadCredMap,
    resolveCred,
    generateFallbackSid
};

export const GeminiClientCredentialManager: GeminiClientCredentialManagerModule = {
    getBlFromPage,
    getAtFromPage,
    detectSlot,
    getCredStorage,
    loadCredMap,
    resolveCred,
    generateFallbackSid
};

export default GeminiClientCredentialManager;
