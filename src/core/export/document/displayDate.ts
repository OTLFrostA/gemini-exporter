import { toIso } from '../../domain/time.js';

/** Select the first valid source fact in the caller's documented priority order. */
export function selectDisplayDate(...candidates: unknown[]): string | undefined {
    for (const candidate of candidates) {
        const iso = toIso(candidate);
        if (iso) return iso.slice(0, 10);
    }
    return undefined;
}
