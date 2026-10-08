import { needsDomainBroker } from './transport.js';
import { readStorageDomain } from './validate.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { openDetailDB, DETAIL_STORE, __getMemoryStore } from '../conversationDetailStore.js';
import { parseLegacyStorageConversation } from '../../parsers/legacyStorage/parseConversation.js';
import { backupLegacyValue, saveDomainConversation } from './domainStore.js';
import { normId } from '../../utils/pathUtils.js';
import type { DomainMigrationReport } from './contracts.js';

export const DOMAIN_MIGRATION_REPORT_KEY = 'gemini_domain_migration_v2';
async function legacyDetails(): Promise<unknown[]> {
    if (typeof indexedDB === 'undefined') return [...__getMemoryStore().values()];
    const db = await openDetailDB();
    try {
        return await new Promise<unknown[]>((resolve, reject) => {
            const tx = db.transaction(DETAIL_STORE, 'readonly');
            let values: unknown[] = [];
            tx.oncomplete = () => resolve(values);
            tx.onabort = tx.onerror = () => reject(tx.error || new Error('Legacy detail scan failed'));
            const req = tx.objectStore(DETAIL_STORE).getAll();
            req.onsuccess = () => { values = req.result; };
        });
    } finally { db.close(); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identity = (value: unknown): string => object(value) && (typeof value.id === 'string' || typeof value.id === 'number') ? normId(String(value.id)) : '';

/** Copy and verify before marking v2. Legacy keys/DB stay intact; failures are retryable. */
export async function migrateLegacyDomains(): Promise<DomainMigrationReport> {
    const all = await chrome.storage.local.get<Record<string, unknown>>(null);
    const lists = Object.entries(all).flatMap(([key, value]) => {
        const slot = key === 'gemini_conversations' || key === 'gemini_conversations_u0' ? 'u0' : key.match(/^gemini_conversations_(u\d+)$/)?.[1];
        return slot && Array.isArray(value) ? [{ key, slot, rows: value as unknown[] }] : [];
    });
    const report: DomainMigrationReport = { converted: 0, issues: [] };
    const details = await legacyDetails();
    const detailById = new Map(details.map(value => [identity(value), value]));
    const owners = new Map<string, Set<string>>();
    for (const list of lists) for (const row of list.rows) {
        const id = identity(row);
        if (id) { const slots = owners.get(id) ?? new Set(); slots.add(list.slot); owners.set(id, slots); }
    }
    // Back up all source containers before a single semantic conversion.
    for (const list of lists) await backupLegacyValue(`chrome:${list.key}`, list.rows);
    for (const [index, value] of details.entries()) await backupLegacyValue(`idb:${identity(value) || index}`, value);
    for (const list of lists) for (const [index, row] of list.rows.entries()) {
        const id = identity(row);
        const key = `${list.key}[${index}]`;
        if (!id) { report.issues.push({ key, code: 'LEGACY_INVALID_METADATA', message: 'Original row preserved; no valid conversation identity' }); continue; }
        const ambiguous = (owners.get(id)?.size ?? 0) > 1 && detailById.has(id);
        const raw = { metadata: row, ...(ambiguous ? {} : { detail: detailById.get(id) }) };
        let parsed: ResourceConversationParseResult;
        try {
            parsed = parseLegacyStorageConversation(raw, { providerId: 'gemini' });
            if (ambiguous) {
                parsed.conversation.completeness = { status: 'partial', reason: 'Legacy detail has no account identity and is referenced by multiple accounts.' };
                report.issues.push({ key, code: 'LEGACY_AMBIGUOUS_ACCOUNT', message: 'Unscoped detail retained; not assigned to any account' });
            }
            readStorageDomain(parsed.conversation);
        } catch (error) {
            // A malformed source is preserved and reported; a durable write failure must abort.
            if (!(error instanceof TypeError)) throw error;
            report.issues.push({ key, code: 'LEGACY_PARSE_REJECTED', message: error.message });
            continue;
        }
        const transferred = await saveDomainConversation(list.slot, parsed, [], true);
        if (!transferred) { report.issues.push({ key, code: 'LEGACY_PREVIOUSLY_REMOVED', message: 'Deleted body not restored by migration retry' }); continue; }
        report.converted++;
        report.issues.push(...parsed.diagnostics.filter(d => d.severity !== 'info').map(d => ({ key, code: d.code, message: d.message })));
    }
    for (const value of details) {
        const id = identity(value);
        if (!owners.has(id)) report.issues.push({ key: `idb:${id}`, code: 'LEGACY_ORPHAN_DETAIL', message: 'Original detail retained without guessing its account' });
    }
    const reportKey = needsDomainBroker() ? `${DOMAIN_MIGRATION_REPORT_KEY}:${location.origin}` : DOMAIN_MIGRATION_REPORT_KEY;
    await chrome.storage.local.set({ [reportKey]: report });
    return report;
}

/** v1 also existed under the web origin. Transfer it once, even after global v2 startup. */
export async function migrateHostLegacyDomains(): Promise<void> {
    if (!needsDomainBroker()) return;
    const marker = `gemini_domain_host_migration_v2:${location.origin}`;
    const stored = await chrome.storage.local.get<Record<string, unknown>>([marker]);
    if (stored[marker] === 2) return;
    await migrateLegacyDomains();
    await chrome.storage.local.set({ [marker]: 2 });
}
