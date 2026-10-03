// Runs cleanups before re-injected bundles register new listeners.

/**
 * Register a cleanup to run before the next bundle (re-)initializes.
 * The cleanup typically removes a listener/timer/observer this bundle added.
 */
export function registerCleanup(fn: () => void): void {
    if (typeof window === 'undefined') return;
    if (!Array.isArray(window.__gemExporterCleanups)) window.__gemExporterCleanups = [];
    window.__gemExporterCleanups.push(fn);
}

/**
 * Run and clear all cleanups registered by the previous bundle.
 * Called once at the top of the content-script re-init path.
 */
export function runCleanups(): void {
    if (typeof window === 'undefined') return;
    const fns: Array<() => void> = Array.isArray(window.__gemExporterCleanups) ? window.__gemExporterCleanups : [];
    window.__gemExporterCleanups = [];
    for (const fn of fns) {
        try {
            fn();
        } catch {
            /* intentional: best-effort cleanup must never break init */
        }
    }
}

export function pendingCleanupCount(): number {
    if (typeof window === 'undefined') return 0;
    return Array.isArray(window.__gemExporterCleanups) ? window.__gemExporterCleanups.length : 0;
}
