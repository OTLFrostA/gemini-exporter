/** L2 serializes fact selection across extension contexts; Storage remains passive. */
const pending = new Map<string, Promise<unknown>>();
export function withAdmissionLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks) {
        return navigator.locks.request(`gemini-v2-admission:${key}`, work);
    }
    const previous = pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    pending.set(key, next);
    void next.finally(() => { if (pending.get(key) === next) pending.delete(key); }).catch(() => undefined);
    return next;
}
