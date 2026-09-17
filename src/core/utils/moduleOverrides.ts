// src/core/utils/moduleOverrides.ts - Central test seam for module resolution.
//
// Legacy pattern this replaces:
//   const getStore = () => (typeof (globalThis as any).ConversationsStore !== 'undefined'
//       ? (globalThis as any).ConversationsStore : ConversationsStore);
//
// Unit tests used to mount mocks on `globalThis`, which was fragile: merely
// requiring a module transitively re-ran its bottom-of-file self-registration
// and clobbered the mocks (see tests/options_title_persist.test.ts NOTE).
// Tests now call __setModuleOverride(name, impl); production code resolves
// through __resolveModule(name, staticFallback).
//
// Resolution order: explicit test override → legacy globalThis entry → static import.
// The globalThis middle step is temporary (kept so not-yet-migrated readers keep
// working) and will be removed in a follow-up once nothing mounts on globalThis.

const overrides = new Map<string, any>();

export function __setModuleOverride(name: string, impl: any): void {
    if (impl === undefined) overrides.delete(name);
    else overrides.set(name, impl);
}

export function __clearModuleOverrides(): void {
    overrides.clear();
}

/** Read the current explicit override (test teardown bookkeeping). */
export function __getModuleOverride(name: string): any {
    return overrides.get(name);
}

/** Resolve a module by its legacy global name. Never throws; never returns a promise. */
export function __resolveModule(name: string, fallback: any): any {
    const o = overrides.get(name);
    if (o !== undefined) return o;
    const g = (globalThis as any)[name];
    return g !== undefined ? g : fallback;
}
