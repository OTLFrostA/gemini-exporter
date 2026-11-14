export interface RateLimiter {
    allow(bucketKey: string, limit: number, windowMs: number, nowMs?: number): { allowed: boolean; retryAfterSec: number };
}

/**
 * Bounded fixed-window per-isolate rate limiter with automatic stale-bucket eviction
 * to cap memory usage inside Cloudflare Worker isolates.
 */
export function createRateLimiter(maxTrackedBuckets = 4096): RateLimiter {
    const buckets = new Map<string, { count: number; resetAtMs: number }>();

    return {
        allow(bucketKey, limit, windowMs, nowMs = Date.now()) {
            const existing = buckets.get(bucketKey);
            if (!existing || existing.resetAtMs <= nowMs) {
                if (buckets.size >= maxTrackedBuckets) {
                    for (const [k, v] of buckets) {
                        if (v.resetAtMs <= nowMs || buckets.size >= maxTrackedBuckets) {
                            buckets.delete(k);
                        }
                        if (buckets.size < maxTrackedBuckets * 0.75) break;
                    }
                }
                buckets.set(bucketKey, { count: 1, resetAtMs: nowMs + windowMs });
                return { allowed: true, retryAfterSec: 0 };
            }
            if (existing.count >= limit) {
                const retryAfterSec = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));
                return { allowed: false, retryAfterSec };
            }
            existing.count += 1;
            return { allowed: true, retryAfterSec: 0 };
        },
    };
}
