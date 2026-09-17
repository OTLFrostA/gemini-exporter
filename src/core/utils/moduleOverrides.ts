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
// Resolution order: explicit test override → static import.
// The legacy globalThis middle step was removed once the last mounts were
// deleted: nothing in src/ or tests/ mounts these names on globalThis anymore.

const overrides = new Map<string, any>();

export function __setModuleOverride<T = any>(name: string, impl: T | undefined): void {
    if (impl === undefined) overrides.delete(name);
    else overrides.set(name, impl);
}

export function __clearModuleOverrides(): void {
    overrides.clear();
}

/** Read the current explicit override (test teardown bookkeeping). */
export function __getModuleOverride<T = any>(name: string): T | undefined {
    return overrides.get(name);
}

/** Resolve an optional module override where fallback is null/undefined, returning `any`. */
export function __resolveModule(name: string, fallback: null | undefined): any;
/** Resolve a module override: explicit test override wins, else the typed static fallback. */
export function __resolveModule<T>(name: string, fallback: T): T;
export function __resolveModule(name: string, fallback?: any): any {
    const o = overrides.get(name);
    return o !== undefined ? o : fallback;
}
