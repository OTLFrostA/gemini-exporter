import type { PageObservation } from './pageObservation.js';
export interface CoverageKey { id: string; time: number }
export interface CoverageRange { head: CoverageKey; tail: CoverageKey }
export interface StreamCoverage {
    initialized: boolean;
    historyComplete: boolean;
    range: CoverageRange | null;
}
export const emptyStream = (): StreamCoverage => ({ initialized: false, historyComplete: false, range: null });
const overlaps = (a: CoverageRange, b: CoverageRange) => a.tail.time <= b.head.time && b.tail.time <= a.head.time;
const samePage = (a: PageObservation<unknown>, b: PageObservation<unknown>) =>
    a.nextCursor === b.nextCursor && JSON.stringify(a.keys) === JSON.stringify(b.keys);

/** Ephemeral graph: cursors are never persisted or reused to resume a later scan. */
export class CoverageSession {
    private pages = new Map<string | null, PageObservation<unknown>>();
    private conflicts = new Set<string | null>();
    observe<T>(previous: StreamCoverage, page: PageObservation<T>, requireOrder: boolean): StreamCoverage {
        if (!page.requestKnown || !page.valid) return previous;
        if (page.nextCursor !== null && page.nextCursor === page.requestCursor) {
            this.conflicts.add(page.requestCursor); this.pages.delete(page.requestCursor);
            return previous;
        }
        const prior = this.pages.get(page.requestCursor);
        if (prior && !samePage(prior, page)) {
            // The head has no stable token and is replaced by the current snapshot.
            // Retain token pages so passive evidence can precede a new active head.
            // Conflicting non-head tokens remain quarantined for this generation.
            if (page.requestCursor !== null) {
                this.conflicts.add(page.requestCursor);
                this.pages.delete(page.requestCursor);
                return previous;
            }
        }
        if (this.conflicts.has(page.requestCursor)) return previous;
        this.pages.set(page.requestCursor, page);
        if (this.pages.size > 2000) this.pages.delete(this.pages.keys().next().value ?? null);
        let next = { ...previous };
        const incoming = new Set([...this.pages.values()].map(value => value.nextCursor).filter(value => value !== null));
        for (const first of [...this.pages.values()].filter(value => value.requestCursor === null || !incoming.has(value.requestCursor))) {
            const chain = this.chain(first.requestCursor, requireOrder);
            if (!chain) continue;
            const range = chain.keys.length ? { head: chain.keys[0], tail: chain.keys[chain.keys.length - 1] } : null;
            if (first.requestCursor === null && chain.terminal) {
                // A complete current list replaces stale endpoints, even with no overlap.
                return { initialized: true, historyComplete: true, range: requireOrder ? range : null };
            }
            if (!requireOrder || !range || next.range && !overlaps(next.range, range)) continue;
            const old = next.range;
            next = { initialized: true, historyComplete: next.historyComplete,
                range: { head: old && old.head.time >= range.head.time ? old.head : range.head,
                    tail: old && old.tail.time <= range.tail.time ? old.tail : range.tail } };
        }
        return next;
    }
    /** The caller supplies this run's persisted head, never the newly advanced coverage. */
    connects(previous: StreamCoverage, head: PageObservation<unknown>): boolean {
        if (!previous.initialized || !previous.range || head.requestCursor !== null
            || !head.requestKnown || !head.valid || !head.ordered) return false;
        const sharedHead = this.pages.get(null);
        if (!sharedHead || !samePage(sharedHead, head)) return false;
        const chain = this.chain(null, true);
        return !!chain?.keys.length && overlaps(previous.range,
            { head: chain.keys[0], tail: chain.keys[chain.keys.length - 1] });
    }
    /** One cursor walk is used by both coverage merging and incremental completion. */
    private chain(entryCursor: string | null, requireOrder: boolean): { keys: CoverageKey[]; terminal: boolean } | null {
        let current = this.pages.get(entryCursor);
        const visited = new Set<string | null>();
        const keys: CoverageKey[] = [];
        const ids = new Set<string>();
        const counts = new Map<string, number>();
        for (const page of this.pages.values()) if (page.nextCursor !== null) counts.set(page.nextCursor, (counts.get(page.nextCursor) ?? 0) + 1);
        while (current) {
            if (visited.has(current.requestCursor) || !current.requestKnown || !current.valid
                || requireOrder && !current.ordered) break;
            visited.add(current.requestCursor);
            if (requireOrder && keys.length && current.keys.length && keys[keys.length - 1].time <= current.keys[0].time) break;
            // Reject the entire conflicting page, retaining only the verified prefix.
            if (new Set(current.keys.map(key => key.id)).size !== current.keys.length || current.keys.some(key => ids.has(key.id))) break;
            for (const key of current.keys) { ids.add(key.id); keys.push(key); }
            if (current.nextCursor === null) return { keys, terminal: true };
            if (this.conflicts.has(current.nextCursor) || (counts.get(current.nextCursor) ?? 0) > 1) break;
            current = this.pages.get(current.nextCursor);
        }
        return { keys, terminal: false };
    }
}
