let frozenMessage = () => "Unsupported storage schema; writes are blocked";
export function setSchemaFrozenMessage(factory: () => string): void { frozenMessage = factory; }

export const SCHEMA_VERSION_KEY = "gemini_schema_version";
export const CURRENT_SCHEMA_VERSION = 3;

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
            void Promise.resolve(action.setBadgeText({ text: "!" })).catch(error => console.warn("Unable to display frozen storage badge", error));
            if (typeof action.setBadgeBackgroundColor === "function") {
                void Promise.resolve(action.setBadgeBackgroundColor({ color: "#C53929" })).catch(error => console.warn("Unable to color frozen storage badge", error));
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
    // script, options page) still reject every unsupported stored version.
    try {
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get<Record<string, unknown>>([SCHEMA_VERSION_KEY]);
            const v = data ? data[SCHEMA_VERSION_KEY] : undefined;
            if (v !== undefined && v !== CURRENT_SCHEMA_VERSION) {
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
