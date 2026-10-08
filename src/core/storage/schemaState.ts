let frozenMessage = () => "Storage schema is newer than this extension; writes are blocked";
export function setSchemaFrozenMessage(factory: () => string): void { frozenMessage = factory; }

export const SCHEMA_VERSION_KEY = "gemini_schema_version";
export const CURRENT_SCHEMA_VERSION = 2;

export class SchemaFrozenError extends Error {
    constructor() {
        super(frozenMessage());
        this.name = "SchemaFrozenError";
    }
}

let _frozen = false;

export function isSchemaFrozen(): boolean {
    return _frozen;
}

export function __setSchemaFrozenForTest(v: boolean): void {
    _frozen = v;
}

function warnSchemaFrozen(): void {
    try {
        const action = (typeof chrome !== "undefined" && chrome.action) || null;
        if (action && typeof action.setBadgeText === "function") {
            action.setBadgeText({ text: "!" });
            if (typeof action.setBadgeBackgroundColor === "function") {
                action.setBadgeBackgroundColor({ color: "#C53929" });
            }
        }
    } catch {}
}

/**
 * Fail-closed write guard. Reads stay available when frozen; every write
 * funnel must call this before touching storage.
 */
export async function assertSchemaWritable(): Promise<void> {
    if (_frozen) {
        warnSchemaFrozen();
        throw new SchemaFrozenError();
    }
    // Lazy cross-context check: contexts that never ran migrate() (content
    // script, options page) still see a version stamped by a newer release.
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get<Record<string, unknown>>([SCHEMA_VERSION_KEY]);
            const v = data ? data[SCHEMA_VERSION_KEY] : undefined;
            if (typeof v === "number" && v > CURRENT_SCHEMA_VERSION) {
                _frozen = true;
                warnSchemaFrozen();
                throw new SchemaFrozenError();
            }
        }
    } catch (e) {
        if (e instanceof SchemaFrozenError) throw e;
        // Storage unreadable -> fail open; frozen only on positive evidence.
    }
}


export function markSchemaFrozen(): void { _frozen = true; warnSchemaFrozen(); }
