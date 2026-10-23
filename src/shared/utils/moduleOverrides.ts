/**
 * Test seam for module resolution. Replaces fragile globalThis mocking where
 * transitively requiring modules re-ran registrations and clobbered mocks.
 */

const isProduction = (): boolean =>
    typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

const overrides = new Map<string, unknown>();

export function __setModuleOverride<T = unknown>(name: string, impl: T | undefined): void {
    if (isProduction()) return;
    if (impl === undefined) overrides.delete(name);
    else overrides.set(name, impl);
}

export function __getModuleOverride<T = unknown>(name: string): T | undefined {
    if (isProduction()) return undefined;
    return overrides.get(name) as T | undefined;
}

export function __resolveModule<T>(name: string, fallback: T): T {
    if (isProduction()) return fallback;
    const o = overrides.get(name);
    return o !== undefined ? o as T : fallback;
}

