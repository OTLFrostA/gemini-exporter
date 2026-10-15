import { migrateDomainSnapshots } from './domain/domainStore.js';
import { migrateLegacyDomains } from './domain/migrateLegacy.js';
// Why this exists (P1-10 / P1-13): storage migrations used to be scattered
// across read paths ("migrate on touch"): getConversations fire-and-forget a
// legacy slim migration with a stale snapshot (lost-update hole across tabs),
// export-record alias collapse ran on every read, credential normalization
// ran inside loadCredMap, and IDB creation was implicit. There was no schema
// version key, so future format changes had no detection point.
//
// New contract:
// - `gemini_schema_version` in chrome.storage.local, current = 3.
// - `migrate()` runs once at startup, serially: legacy detail / export-alias /
//   credentials / IDB / index, then stamps the version.
// - Unknown future version -> migrate() returns { ok:false, frozen:true } and
//   sets the SCHEMA_FROZEN flag: reads keep working, writes fail closed via
//   assertSchemaWritable() (i18n error + badge warning).
// - Read paths never migrate; they only read.

import {
    normSlot,
    getAccountSlots,
    migrateConversationIndexes,
    migrateExportAliases
} from "./storageService.js";
import { migrateCredentials } from "../api/client/credentialManager.js";
import { openHandleDB } from "./idbHandleStore.js";
import { openDetailDB } from "./conversationDetailStore.js";
import { getErrorMessage } from "../utils/messaging.js";
import { t } from "../utils/i18n.js";

import { SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION, SchemaFrozenError, __setSchemaFrozenForTest, markSchemaFrozen, setSchemaFrozenMessage } from './schemaState.js';
export { SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION, SchemaFrozenError, isSchemaFrozen, __setSchemaFrozenForTest, assertSchemaWritable } from './schemaState.js';
setSchemaFrozenMessage(() => t('schemaFrozenWriteBlocked'));
export interface SchemaMigrateResult { ok: boolean; frozen: boolean; error?: string }

async function listConversationSlots(): Promise<string[]> {
    const slots = new Set<string>(["u0"]);
    try {
        const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
        for (const k of Object.keys(all || {})) {
            if (k === "gemini_conversations") slots.add("u0");
            else if (k.startsWith("gemini_conversations_")) {
                const s = k.slice("gemini_conversations_".length);
                if (s) slots.add(s);
            }
        }
    } catch {}
    try {
        const acc = await getAccountSlots();
        for (const k of Object.keys(acc || {})) slots.add(normSlot(k));
    } catch {}
    return [...slots];
}

async function migrateExportAliasesAll(): Promise<void> {
    const slots = await listConversationSlots();
    for (const slot of slots) {
        await migrateExportAliases(slot);
    }
}

async function migrateStepCredentials(): Promise<void> {
    await migrateCredentials();
}

async function migrateIdb(): Promise<void> {
    if (typeof indexedDB === "undefined") return;
    for (const open of [openHandleDB, openDetailDB] as const) {
        const db = await open();
        try { db.close(); } catch {}
    }
}

/**
 * Startup one-time migration. Serial: legacy detail -> alias -> credentials -> IDB -> index,
 * then stamps gemini_schema_version = 3. Idempotent; safe to call from
 * multiple contexts (cross-tab locks serialize the write steps).
 * If any step fails, the version stamp is withheld and ok: false is returned
 * so migration can be retried on next startup.
 */
export async function migrate(): Promise<SchemaMigrateResult> {
    let stored: unknown;
    try {
        const data = await chrome.storage.local.get([SCHEMA_VERSION_KEY]);
        stored = data ? (data as any)[SCHEMA_VERSION_KEY] : undefined;
    } catch {
        stored = undefined;
    }
    if (typeof stored === "number" && stored > CURRENT_SCHEMA_VERSION) {
        markSchemaFrozen();
        return { ok: false, frozen: true };
    }
    __setSchemaFrozenForTest(false);
    const fromVersion = typeof stored === "number" && stored >= 0 ? Math.floor(stored) : 0;
    if (fromVersion < CURRENT_SCHEMA_VERSION) {
        try {
            // Upgrade flat v2 snapshots atomically before migrating older legacy records.
            // Preserve fat v0 rows and unscoped v1 details before canonical index conversion.
            await migrateDomainSnapshots();
            if (fromVersion < 2) await migrateLegacyDomains();
            if (fromVersion < 1) {
                await migrateExportAliasesAll();
                await migrateStepCredentials();
                await migrateIdb();
            }
            if (fromVersion < 2) await migrateConversationIndexes();
            await chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION });
        } catch (e: unknown) {
            console.error("[SchemaMigration] Migration step failed, version stamp withheld for retry:", e);
            return { ok: false, frozen: false, error: getErrorMessage(e) };
        }
    }
    return { ok: true, frozen: false };
}

let _storageReadyPromise: Promise<void> | null = null;

async function initializeStorage(): Promise<void> {
    const res = await migrate();
    if (res.frozen) {
        throw new SchemaFrozenError();
    }
    if (!res.ok) {
        throw new Error(res.error || "Storage schema migration failed");
    }
}

/**
 * Storage readiness boundary contract.
 *
 * Ensures storage schema migration has completed before any consumer operates
 * on canonical storage data.
 * - Concurrency: Concurrent callers share the same in-flight initialization.
 * - Idempotency: Later callers reuse the settled readiness state without remigrating.
 * - Failure semantics: Fails closed on migration error or schema freeze (rejects).
 */
export function ensureStorageReady(): Promise<void> {
    if (!_storageReadyPromise) {
        _storageReadyPromise = initializeStorage();
    }
    return _storageReadyPromise;
}

export function __resetStorageReadyForTest(): void {
    _storageReadyPromise = null;
    __setSchemaFrozenForTest(false);
}
