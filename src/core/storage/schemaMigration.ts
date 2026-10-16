import { needsDomainBroker, callDomainBroker } from './domain/transport.js';
import { openDomainDB } from './domain/domainStore.js';
import { getErrorMessage } from '../utils/messaging.js';
import { t } from '../utils/i18n.js';
import { SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION, SchemaFrozenError, __setSchemaFrozenForTest, markSchemaFrozen, setSchemaFrozenMessage } from './schemaState.js';
export { SCHEMA_VERSION_KEY, CURRENT_SCHEMA_VERSION, SchemaFrozenError, isSchemaFrozen, __setSchemaFrozenForTest, assertSchemaWritable } from './schemaState.js';
setSchemaFrozenMessage(() => t('schemaFrozenWriteBlocked'));
export interface SchemaMigrateResult { ok: boolean; frozen: boolean; error?: string }

/** Initialize only the current schema. No legacy conversion or account reassignment. */
export async function migrate(): Promise<SchemaMigrateResult> {
    try {
        if (needsDomainBroker()) { await callDomainBroker('ready', {}); return { ok: true, frozen: false }; }
        const data = await chrome.storage.local.get<Record<string, unknown>>([SCHEMA_VERSION_KEY]);
        const stored = data[SCHEMA_VERSION_KEY];
        if (stored !== undefined && stored !== CURRENT_SCHEMA_VERSION) {
            markSchemaFrozen();
            return { ok: false, frozen: true, error: 'Unsupported storage schema' };
        }
        __setSchemaFrozenForTest(false);
        if (typeof indexedDB !== 'undefined') { const db = await openDomainDB(); db.close(); }
        if (stored === undefined) await chrome.storage.local.set({ [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION });
        return { ok: true, frozen: false };
    } catch (error) { return { ok: false, frozen: false, error: getErrorMessage(error) }; }
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
