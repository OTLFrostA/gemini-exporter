import type { PageObservation } from './pageObservation.js';
export interface CoverageKey { id: string; time: number }
export interface CoverageRange { head: CoverageKey; tail: CoverageKey }
export interface StreamCoverage { range: CoverageRange | null }
export const emptyStream = (): StreamCoverage => ({ range: null });
export function readStreamCoverage(value: unknown): StreamCoverage | null {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => k !== 'range') || !('range' in value)) return null;
    const range = value.range;
    if (range === null) return emptyStream();
    if (!range || typeof range !== 'object' || Array.isArray(range) || Object.keys(range).some(k => k !== 'head' && k !== 'tail') || !('head' in range) || !('tail' in range)) return null;
    const key = (v: unknown): v is CoverageKey => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => k === 'id' || k === 'time') && 'id' in v && typeof v.id === 'string'
        && !!v.id && 'time' in v && typeof v.time === 'number' && Number.isSafeInteger(v.time);
    return key(range.head) && key(range.tail) ? { range: { head: { ...range.head }, tail: { ...range.tail } } } : null;
}
const overlaps = (a: CoverageRange, b: CoverageRange) => a.tail.time <= b.head.time && b.tail.time <= a.head.time;
const samePage = (a: PageObservation<unknown>, b: PageObservation<unknown>) =>
    a.providerId === b.providerId && a.accountId === b.accountId && a.streamId === b.streamId
    && a.requestedAt === b.requestedAt && a.nextCursor === b.nextCursor && a.ordered === b.ordered
    && a.requestKnown === b.requestKnown && a.valid === b.valid && a.terminal === b.terminal
    && JSON.stringify(a.keys) === JSON.stringify(b.keys);

/** Ephemeral cursor evidence. Only a verified terminal chain establishes a new durable range. */
export class CoverageSession {
    private pages = new Map<string | null, PageObservation<unknown>>();
    private conflicts = new Set<string | null>();
    fork(): CoverageSession {
        const copy = new CoverageSession();
        copy.pages = new Map(this.pages); copy.conflicts = new Set(this.conflicts);
        return copy;
    }
    observe<T>(previous: StreamCoverage, page: PageObservation<T>): StreamCoverage {
        const prior = this.pages.get(page.requestCursor);
        if (page.requestCursor === null && (this.conflicts.has(null) || prior && !samePage(prior, page))) {
            if (prior && page.requestedAt < prior.requestedAt) return previous;
            this.pages.clear(); this.conflicts.clear();
        }
        if (!page.requestKnown || !page.valid || !page.ordered || !Number.isSafeInteger(page.requestedAt)
            || page.nextCursor !== null && page.nextCursor === page.requestCursor) {
            this.conflicts.add(page.requestCursor); this.pages.delete(page.requestCursor); return previous;
        }
        if (prior && page.requestCursor !== null && !samePage(prior, page)) {
            this.conflicts.add(page.requestCursor); this.pages.delete(page.requestCursor); return previous;
        }
        if (this.conflicts.has(page.requestCursor)) return previous;
        this.pages.set(page.requestCursor, page);
        if (this.pages.size > 2000) this.pages.delete(this.pages.keys().next().value ?? null);
        const chain = this.chain();
        return chain.terminal ? { range: chain.range } : previous;
    }
    exhausted(): boolean { return this.chain().terminal; }
    connects(previous: StreamCoverage, head: PageObservation<unknown>): boolean {
        const anchor = this.pages.get(null);
        const chain = this.chain();
        return !!previous.range && head.requestCursor === null && !!anchor
            && samePage(anchor, { ...head, providerId: anchor.providerId })
            && !!chain.range && overlaps(previous.range, chain.range);
    }
    extend(previous: StreamCoverage): StreamCoverage {
        const range = this.chain().range;
        if (!previous.range || !range) return previous;
        return { range: { head: range.head.time >= previous.range.head.time ? range.head : previous.range.head,
            tail: range.tail.time <= previous.range.tail.time ? range.tail : previous.range.tail } };
    }
    private chain(): { range: CoverageRange | null; terminal: boolean } {
        let page = this.pages.get(null);
        const anchor = page;
        const visited = new Set<string | null>(), ids = new Set<string>();
        const keys: CoverageKey[] = [];
        let lastTime = Infinity, lastRequestedAt = -Infinity;
        while (page && anchor) {
            if (visited.has(page.requestCursor) || this.conflicts.has(page.requestCursor) || !page.requestKnown || !page.valid || !page.ordered
                || page.providerId !== anchor.providerId || page.accountId !== anchor.accountId || page.streamId !== anchor.streamId
                || page.requestedAt < lastRequestedAt
                || page.keys.some(k => !k.id || !Number.isSafeInteger(k.time) || ids.has(k.id) || k.time > lastTime)
                || new Set(page.keys.map(k => k.id)).size !== page.keys.length) break;
            visited.add(page.requestCursor);
            for (const key of page.keys) { ids.add(key.id); keys.push(key); }
            if (page.keys.length) lastTime = page.keys[page.keys.length - 1].time;
            lastRequestedAt = page.requestedAt;
            if (page.nextCursor === null) return { range: keys.length ? { head: keys[0], tail: keys[keys.length - 1] } : null, terminal: true };
            page = this.pages.get(page.nextCursor);
        }
        return { range: keys.length ? { head: keys[0], tail: keys[keys.length - 1] } : null, terminal: false };
    }
}
