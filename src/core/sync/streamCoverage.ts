import type { PageObservation } from './pageObservation.js';
export interface CoverageKey { id: string; time: number }
export interface CoverageRange { head: CoverageKey; tail: CoverageKey }
export interface StreamCoverage {
    initialized: boolean;
    historyComplete: boolean;
    range: CoverageRange | null;
}
export const emptyStream = (): StreamCoverage => ({ initialized: false, historyComplete: false, range: null });
const same = (a: CoverageKey, b: CoverageKey) => a.id === b.id && a.time === b.time;

/** Ephemeral graph: cursors are never persisted or reused to resume a later scan. */
export class CoverageSession {
    private pages = new Map<string | null, PageObservation<unknown>>();
    private conflicts = new Set<string | null>();
    observe<T>(previous: StreamCoverage, page: PageObservation<T>, requireOrder: boolean): StreamCoverage {
        if (!page.requestKnown || !page.valid
            || (page.nextCursor !== null && page.nextCursor === page.requestCursor)) return previous;
        const prior = this.pages.get(page.requestCursor);
        if (prior && (prior.nextCursor !== page.nextCursor || JSON.stringify(prior.keys) !== JSON.stringify(page.keys))) {
            // A cursor reused across snapshots is ambiguous. Never splice those responses.
            if (page.requestCursor === null) {
                this.pages.clear(); this.conflicts.clear();
                return this.observe(previous, page, requireOrder);
            }
            this.conflicts.add(page.requestCursor);
            this.pages.delete(page.requestCursor);
            return previous;
        }
        if (this.conflicts.has(page.requestCursor)) return previous;
        this.pages.set(page.requestCursor, page);
        if (this.pages.size > 2000) this.pages.delete(this.pages.keys().next().value ?? null);
        let next = { ...previous };
        const incoming = new Set([...this.pages.values()].map(value => value.nextCursor).filter(value => value !== null));
        const counts = new Map<string, number>();
        for (const value of this.pages.values()) if (value.nextCursor !== null) counts.set(value.nextCursor, (counts.get(value.nextCursor) ?? 0) + 1);
        for (const first of [...this.pages.values()].filter(value => value.requestCursor === null || !incoming.has(value.requestCursor))) {
            const visited = new Set<string | null>();
            let current: PageObservation<unknown> | undefined = first;
            const keys: CoverageKey[] = [];
            let terminal = false;
            let consistent = true;
            let ordered = true;
            while (current) {
                if (visited.has(current.requestCursor)) { consistent = false; break; }
                visited.add(current.requestCursor);
                ordered = ordered && current.ordered;
                if (requireOrder && keys.length && current.keys.length
                    && keys[keys.length - 1].time <= current.keys[0].time) ordered = false;
                keys.push(...current.keys);
                if (current.nextCursor === null) { terminal = true; break; }
                if ((counts.get(current.nextCursor) ?? 0) > 1) { consistent = false; break; }
                current = this.pages.get(current.nextCursor);
            }
            if (!consistent || new Set(keys.map(key => key.id)).size !== keys.length) continue;
            if (first.requestCursor === null && terminal) next = { ...next, initialized: true, historyComplete: true };
            if (!requireOrder || !ordered) {
                // Unordered streams (e.g. pinned) only certify a complete cursor chain.
                if (first.requestCursor === null && terminal) next = { ...next, initialized: true, historyComplete: true };
                continue;
            }
            if (!keys.length) {
                if (first.requestCursor === null && terminal) next = { ...next, initialized: true, historyComplete: true };
                continue;
            }
            const range = { head: keys[0], tail: keys[keys.length - 1] };
            // Exact server ID+key overlap proves connection. Numeric overlap alone does not.
            const connected = !next.range || keys.some(key => same(key, next.range!.head) || same(key, next.range!.tail));
            if (!connected) continue;
            const old = next.range;
            next = { initialized: true, historyComplete: next.historyComplete || (first.requestCursor === null && terminal),
                range: { head: old && old.head.time >= range.head.time ? old.head : range.head,
                    tail: old && old.tail.time <= range.tail.time ? old.tail : range.tail } };
        }
        return next;
    }
    connects(previous: StreamCoverage, entryCursor: string | null, lastCursor: string | null): boolean {
        if (!previous.initialized || !previous.range) return false;
        let current = this.pages.get(entryCursor);
        const visited = new Set<string | null>();
        const keys: CoverageKey[] = [];
        while (current) {
            if (visited.has(current.requestCursor) || !current.valid || !current.ordered) return false;
            visited.add(current.requestCursor);
            if (keys.length && current.keys.length && keys[keys.length - 1].time <= current.keys[0].time) return false;
            keys.push(...current.keys);
            if (current.requestCursor === lastCursor) return new Set(keys.map(key => key.id)).size === keys.length
                && keys.some(key => same(key, previous.range!.head) || same(key, previous.range!.tail));
            if (current.nextCursor === null) return false;
            current = this.pages.get(current.nextCursor);
        }
        return false;
    }
}
