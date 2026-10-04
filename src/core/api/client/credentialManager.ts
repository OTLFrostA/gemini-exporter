import GeminiProtocol, { GeminiProtocolModule } from "../../protocol/protocol.js";
import { detectSlotFromUrl } from "../../utils/pathUtils.js";
import { STORAGE_KEYS } from "../../utils/constants.js";
import { __resolveModule } from "../../utils/moduleOverrides.js";
import { getCredStorage, withCredMapLock } from "./credStorage.js";

export interface GeminiCredentials {
    sid: string;
    at: string;
    bl: string;
    accountSlot: string;
    lastUsed?: number;
}

export type GeminiCredentialsMap = Record<string, GeminiCredentials>;

export interface GeminiClientCredentialManagerModule {
    getBlFromPage: (doc?: unknown) => string | null;
    getAtFromPage: (doc?: unknown) => string;
    detectSlot: (urlOrPath?: string | null) => string | null;
    getCredStorage: () => chrome.storage.StorageArea | null;
    loadCredMap: () => Promise<GeminiCredentialsMap>;
    migrateCredentials: () => Promise<boolean>;
    resolveCred: (targetSidOrSlot?: string | null, overrides?: { at?: string; bl?: string | null; accountSlot?: string } | null) => Promise<GeminiCredentials>;
    generateFallbackSid: () => string;
}

function getProtocol(): GeminiProtocolModule {
    return __resolveModule('GeminiProtocol', GeminiProtocol);
}

const generateFallbackSid = (): string => String(Math.floor(Math.random() * 1e19));

let _blCache: { v: string | null; ts: number; len: number } | null = null;
let _atCache: { v: string; ts: number; len: number } | null = null;
const CRED_CACHE_TTL = 30000;

function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === "object" && val !== null;
}

function getGlobalObject(): Record<string, unknown> | null {
    const candidate: unknown = typeof window !== "undefined"
        ? window
        : (typeof globalThis !== "undefined" ? globalThis : null);
    if (isRecord(candidate)) {
        return candidate;
    }
    return null;
}

function getTargetDocument(doc?: unknown): Record<string, unknown> | null {
    if (isRecord(doc)) {
        return doc;
    }
    const glob = getGlobalObject();
    if (glob && isRecord(glob.document)) {
        return glob.document;
    }
    return null;
}

function getDocumentHtml(targetDoc: Record<string, unknown>): string {
    const docEl = targetDoc.documentElement;
    if (isRecord(docEl) && typeof docEl.innerHTML === "string") {
        return docEl.innerHTML;
    }
    return "";
}

function getBlFromPage(doc?: unknown): string | null {
    try {
        const glob = getGlobalObject();
        const targetDoc = getTargetDocument(doc);
        if (!targetDoc) return null;
        const html = getDocumentHtml(targetDoc);
        const htmlLen = html.length;
        if (_blCache && Date.now() - _blCache.ts < CRED_CACHE_TTL && _blCache.len === htmlLen) {
            return _blCache.v;
        }
        const P = getProtocol();
        const m = html.match(P.TOKEN_PATTERNS.blCfb2hFromHtml) || html.match(P.TOKEN_PATTERNS.blAssistantFromHtml);
        let res: string | null = null;
        if (m && typeof m[1] === "string") {
            res = m[1];
        } else if (glob && typeof glob.__gemExporterBl === "string" && glob.__gemExporterBl) {
            res = glob.__gemExporterBl;
        }
        _blCache = { v: res, ts: Date.now(), len: htmlLen };
        if (res) return res;
    } catch (e) {
        if (typeof console !== "undefined" && typeof console.debug === "function") {
            console.debug("[GemExporter:credentialManager.ts]", e);
        }
    }
    return null;
}

function getAtFromPage(doc?: unknown): string {
    try {
        const glob = getGlobalObject();
        if (glob) {
            const extractAtFn = glob.__gemExporterExtractAt;
            if (typeof extractAtFn === "function") {
                const a: unknown = Reflect.apply(extractAtFn, glob, []);
                if (typeof a === "string" && a) return a;
            }
        }
        const targetDoc = getTargetDocument(doc);
        if (!targetDoc) return "";
        const html = getDocumentHtml(targetDoc);
        const htmlLen = html.length;
        if (_atCache && Date.now() - _atCache.ts < CRED_CACHE_TTL && _atCache.len === htmlLen) {
            return _atCache.v;
        }
        const P = getProtocol();
        if (glob && isRecord(glob._WIZ_global_data)) {
            const v = glob._WIZ_global_data[P.TOKENS.AT];
            if (typeof v === "string" && v) {
                _atCache = { v, ts: Date.now(), len: htmlLen };
                return v;
            }
        }
        if (glob && isRecord(glob.WIZ_global_data)) {
            const v = glob.WIZ_global_data[P.TOKENS.AT];
            if (typeof v === "string" && v) {
                _atCache = { v, ts: Date.now(), len: htmlLen };
                return v;
            }
        }
        if (typeof targetDoc.querySelectorAll === "function") {
            const rawScripts: unknown = Reflect.apply(targetDoc.querySelectorAll, targetDoc, ["script"]);
            if (Array.isArray(rawScripts)) {
                for (const s of rawScripts) {
                    if (isRecord(s) && typeof s.textContent === "string") {
                        const m = s.textContent.match(P.TOKEN_PATTERNS.atFromScript);
                        if (m && typeof m[1] === "string") {
                            _atCache = { v: m[1], ts: Date.now(), len: htmlLen };
                            return m[1];
                        }
                    }
                }
            } else if (isRecord(rawScripts) && typeof rawScripts.length === "number") {
                const len = rawScripts.length;
                for (let i = 0; i < len; i++) {
                    const s = rawScripts[i];
                    if (isRecord(s) && typeof s.textContent === "string") {
                        const m = s.textContent.match(P.TOKEN_PATTERNS.atFromScript);
                        if (m && typeof m[1] === "string") {
                            _atCache = { v: m[1], ts: Date.now(), len: htmlLen };
                            return m[1];
                        }
                    }
                }
            }
        }
        const mHtml = html.match(P.TOKEN_PATTERNS.atFromScript);
        if (mHtml && typeof mHtml[1] === "string") {
            _atCache = { v: mHtml[1], ts: Date.now(), len: htmlLen };
            return mHtml[1];
        }
    } catch (e) {
        if (typeof console !== "undefined" && typeof console.debug === "function") {
            console.debug("[GemExporter:credentialManager.ts]", e);
        }
    }
    return "";
}

function detectSlot(urlOrPath?: string | null): string | null {
    try {
        let path = typeof urlOrPath === "string" ? urlOrPath : "";
        if (!path) {
            const glob = getGlobalObject();
            if (glob && isRecord(glob.location) && typeof glob.location.pathname === "string") {
                path = glob.location.pathname;
            }
        }
        const slot = detectSlotFromUrl(path);
        return slot === "u0" ? "default" : slot;
    } catch (e) {
        if (typeof console !== "undefined" && typeof console.debug === "function") {
            console.debug("[GemExporter:credentialManager.ts]", e);
        }
    }
    return "default";
}

function normalizeLegacySingleCred(s: unknown, map: GeminiCredentialsMap): void {
    if (!isRecord(s)) return;
    const legacy = s[STORAGE_KEYS.CREDENTIALS];
    if (!isRecord(legacy)) return;
    const rawSid = legacy.sid;
    const sid = typeof rawSid === "string" ? rawSid : (typeof rawSid === "number" ? String(rawSid) : "");
    if (sid && !map[sid]) {
        const at = typeof legacy.at === "string" ? legacy.at : "";
        const bl = typeof legacy.bl === "string" && legacy.bl ? legacy.bl : getProtocol().BL_FALLBACK;
        map[sid] = {
            at,
            bl,
            sid,
            accountSlot: "default",
            lastUsed: Date.now()
        };
    }
}

function parseCredentialsMap(raw: unknown): GeminiCredentialsMap {
    if (!isRecord(raw)) return {};
    const map: GeminiCredentialsMap = {};
    for (const [key, val] of Object.entries(raw)) {
        if (!isRecord(val)) continue;
        const sid = typeof val.sid === "string" ? val.sid : key;
        const at = typeof val.at === "string" ? val.at : "";
        const bl = typeof val.bl === "string" ? val.bl : "";
        const accountSlot = typeof val.accountSlot === "string" ? val.accountSlot : "default";
        const cred: GeminiCredentials = {
            sid,
            at,
            bl,
            accountSlot
        };
        if (typeof val.lastUsed === "number") {
            cred.lastUsed = val.lastUsed;
        }
        map[key] = cred;
    }
    return map;
}

async function loadCredMap(): Promise<GeminiCredentialsMap> {
    const storage = getCredStorage();
    if (!storage) return {};
    try {
        const s: unknown = await storage.get([STORAGE_KEYS.CREDENTIALS_MAP]);
        if (isRecord(s)) {
            return parseCredentialsMap(s[STORAGE_KEYS.CREDENTIALS_MAP]);
        }
        return {};
    } catch {
        return {};
    }
}

let _resolveChain: Promise<unknown> = Promise.resolve();
function runSerializedResolve<T>(op: () => Promise<T>): Promise<T> {
    const run = _resolveChain.then(op, op);
    _resolveChain = run.then(() => undefined, () => undefined);
    return run;
}

async function resolveCred(
    targetSidOrSlot?: string | null,
    overrides?: { at?: string; bl?: string | null; accountSlot?: string } | null
): Promise<GeminiCredentials> {
    return runSerializedResolve(() => withCredMapLock(() => resolveCredInner(targetSidOrSlot, overrides)));
}

async function resolveCredInner(
    targetSidOrSlot?: string | null,
    overrides?: { at?: string; bl?: string | null; accountSlot?: string } | null
): Promise<GeminiCredentials> {
    const map = await loadCredMap();
    let vals = Object.values(map);
    const pageAt = getAtFromPage();
    const pageBl = getBlFromPage();

    const normSlot = (s?: string | null) => (s === "u0" || !s ? "default" : s);

    const isSlotParam = targetSidOrSlot && (
        /^u\d+$/i.test(targetSidOrSlot) ||
        targetSidOrSlot.includes('@') ||
        targetSidOrSlot === 'default'
    );
    const targetSid = (!isSlotParam && targetSidOrSlot && map[targetSidOrSlot]) ? targetSidOrSlot : null;
    const requestedSlot = overrides?.accountSlot || (isSlotParam ? targetSidOrSlot : null);

    if ((!vals.length || !vals[0].at) && pageAt) {
        const slot = requestedSlot || detectSlot() || "default";
        const sid = vals[0]?.sid || ("page_" + Date.now());
        const entry: GeminiCredentials = {
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
                if (typeof chrome !== "undefined" && chrome.storage?.local && storage !== chrome.storage.local) {
                    await chrome.storage.local.remove([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
                }
            }
        } catch (e) {
            if (typeof console !== "undefined" && typeof console.debug === "function") {
                console.debug("[GemExporter:credentialManager.ts]", e);
            }
        }
    } else if (pageBl) {
        const curSlot = normSlot(requestedSlot || detectSlot());
        const target = vals.find(v => !v.bl && normSlot(v.accountSlot) === curSlot);
        if (target) {
            target.bl = pageBl;
            try {
                const storage = getCredStorage();
                if (storage) await storage.set({ [STORAGE_KEYS.CREDENTIALS_MAP]: map });
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
        const cur = normSlot(requestedSlot || detectSlot());
        const f = vals.filter(v => normSlot(v.accountSlot) === cur);
        // CRITICAL SECURITY FIX: Do NOT fall back to `vals` when `f` is empty!
        // Borrowing other accounts' credentials causes silent cross-account token pollution.
        const arr = f;
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

async function migrateCredentials(): Promise<boolean> {
    return withCredMapLock(async () => {
        const storage = getCredStorage();
        if (!storage) return false;
        let migrated = false;
        try {
            const s: unknown = await storage.get([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
            const rawMap = isRecord(s) ? s[STORAGE_KEYS.CREDENTIALS_MAP] : null;
            const map: GeminiCredentialsMap = parseCredentialsMap(rawMap);
            const before = Object.keys(map).length;
            normalizeLegacySingleCred(s, map);
            if (Object.keys(map).length !== before) migrated = true;
            if (typeof chrome !== "undefined" && chrome.storage?.local && storage !== chrome.storage.local) {
                try {
                    const localS: unknown = await chrome.storage.local.get([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
                    const localRawMap = isRecord(localS) ? localS[STORAGE_KEYS.CREDENTIALS_MAP] : null;
                    const localMap: GeminiCredentialsMap = parseCredentialsMap(localRawMap);
                    normalizeLegacySingleCred(localS, localMap);
                    let merged = false;
                    for (const [k, v] of Object.entries(localMap)) {
                        if (!map[k]) { map[k] = v; merged = true; }
                    }
                    if (merged) {
                        migrated = true;
                        await chrome.storage.local.remove([STORAGE_KEYS.CREDENTIALS_MAP, STORAGE_KEYS.CREDENTIALS]);
                    }
                } catch { /* intentional: migration fallback */ }
            }
            if (migrated) {
                await storage.set({ [STORAGE_KEYS.CREDENTIALS_MAP]: map });
            }
            if (isRecord(s) && s[STORAGE_KEYS.CREDENTIALS] && typeof storage.remove === 'function') {
                await storage.remove([STORAGE_KEYS.CREDENTIALS]);
            }
        } catch { /* migration best-effort */ }
        return migrated;
    });
}

export {
    getBlFromPage,
    getAtFromPage,
    detectSlot,
    getCredStorage,
    loadCredMap,
    migrateCredentials,
    resolveCred,
    generateFallbackSid
};

export const GeminiClientCredentialManager: GeminiClientCredentialManagerModule = {
    getBlFromPage,
    getAtFromPage,
    detectSlot,
    getCredStorage,
    loadCredMap,
    migrateCredentials,
    resolveCred,
    generateFallbackSid
};

export default GeminiClientCredentialManager;
