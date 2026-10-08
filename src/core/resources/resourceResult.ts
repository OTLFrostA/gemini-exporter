import type { DocumentDiagnostic } from '../diagnostics/documentDiagnostic.js';

/** A recoverable resource failure is separate from conversation/source facts. */
export type ResourceResult<T> =
    | { ok: true; resourceId: string; value: T }
    | { ok: false; resourceId: string; reason: string; code: string };
export type ResourceFailure = Extract<ResourceResult<never>, { ok: false }>;
export interface ResourceDelivery { path: string }

export function missingResource(resourceId: string, reason: string, code = 'RESOURCE_UNAVAILABLE'): ResourceFailure {
    return { ok: false, resourceId, reason, code };
}
export function resourceDiagnostics(results: readonly ResourceResult<unknown>[]): DocumentDiagnostic[] {
    return results.flatMap(result => result.ok ? [] : [{ severity: 'warning' as const,
        code: result.code, message: result.reason, path: `asset:${result.resourceId}` }]);
}
/** Cancellation retains control-flow semantics; only individual resource errors recover. */
export async function attemptResource<T>(resourceId: string, work: () => Promise<T>, signal?: AbortSignal | null): Promise<ResourceResult<T>> {
    signal?.throwIfAborted();
    try {
        const value = await work();
        signal?.throwIfAborted();
        return { ok: true, resourceId, value };
    } catch (error) {
        signal?.throwIfAborted();
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error;
        return missingResource(resourceId, error instanceof Error ? error.message : String(error));
    }
}
/** Abort a queued wait even if its acquisition transport has not returned yet. */
export async function waitForResources<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
    signal?.throwIfAborted();
    if (!signal) return work;
    let onAbort: () => void = () => {};
    try {
        const value = await Promise.race([work, new Promise<never>((_, reject) => {
            onAbort = () => reject(signal.reason ?? new DOMException('Export aborted', 'AbortError'));
            signal.addEventListener('abort', onAbort, { once: true });
        })]);
        signal.throwIfAborted();
        return value;
    } finally { signal.removeEventListener('abort', onAbort); }
}
