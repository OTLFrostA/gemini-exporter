import { __resetStorageReadyForTest } from '../../src/core/storage/schemaMigration.js';
import { __clearDomainMemory } from '../../src/core/storage/domain/domainStore.js';

/** A physical storage mock: no implicit normalization or migration. */
export function indexStorage(seed: Record<string, unknown> = {}) {
    const previous = globalThis.chrome;
    const local = structuredClone(seed);
    let writes = 0;
    let failKey: string | undefined;
    globalThis.chrome = { storage: { local: {
        async get(keys: string | string[] | null) {
            return structuredClone(keys === null ? local : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(k => k in local).map(k => [k, local[k]])));
        },
        async set(values: Record<string, unknown>) {
            if (failKey && failKey in values) throw new Error(`write failed: ${failKey}`);
            writes++; Object.assign(local, structuredClone(values));
        },
        async remove(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) delete local[key]; }
    } } } as typeof chrome;
    __resetStorageReadyForTest();
    __clearDomainMemory();
    return { local, writes: () => writes, fail: (key?: string) => { failKey = key; },
        restore() { globalThis.chrome = previous; __resetStorageReadyForTest(); __clearDomainMemory(); } };
}
