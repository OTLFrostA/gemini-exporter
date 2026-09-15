// rateLimiter.ts - Rate limiting state management and exponential backoff for Gemini export pipeline

export interface RateLimiterOptions {
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    jitterMs?: number;
    /**
     * Honor a server-sent Retry-After: the computed delay is raised to at
     * least this value (may exceed maxDelayMs, matching previous behavior
     * in retryPolicy.handleHttp429).
     */
    retryAfterMs?: number;
}

export interface RateLimitModule {
    RateLimitManager: typeof RateLimitManager;
    isRateLimited: (res: any) => boolean;
    calculateBackoff: (retryCount: number, options?: RateLimiterOptions) => number;
}

/**
 * Check if a response result indicates rate limit (HTTP 429 or quota exceeded).
 *
 * Canonical predicate for the whole codebase: previously inlined variants
 * lived in exportOrchestrator.ts, types/errors.ts (GeminiRpcError) and
 * content/messageRouter.ts (BardErrorInfo / 1096 / resource_exhausted).
 * All call sites now converge here so the semantics cannot drift again.
 */
export function isRateLimited(res: any): boolean {
    if (!res) return false;
    if (res.success) return false;
    if (res.status === 429) return true;
    const err = String(res.error || '');
    if (/429|rate\s*limit|quota|too\s*many\s*requests|resource_exhausted/i.test(err)) return true;
    // Legacy variants previously inlined in content/messageRouter.ts
    return err.includes('BardErrorInfo') || err.includes('1096');
}

/**
 * Calculate exponential backoff delay with jitter.
 */
export function calculateBackoff(retryCount: number, options?: RateLimiterOptions): number {
    const initial = options?.initialDelayMs ?? 2000;
    const max = options?.maxDelayMs ?? 30000;
    const jitter = options?.jitterMs ?? 1000;
    const delay = initial * Math.pow(2, retryCount) + Math.floor(Math.random() * jitter);
    const capped = Math.min(max, delay);
    const retryAfterMs = options?.retryAfterMs;
    if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
        return Math.max(capped, retryAfterMs);
    }
    return capped;
}

/**
 * RateLimitManager - Manages circuit cooldown, retry counts, and backoff for batch export workers.
 */
export class RateLimitManager {
    rateLimitCooldownUntil: number;
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    jitterMs: number;

    constructor(options?: RateLimiterOptions) {
        this.rateLimitCooldownUntil = 0;
        this.maxRetries = options?.maxRetries ?? 3;
        this.initialDelayMs = options?.initialDelayMs ?? 2000;
        this.maxDelayMs = options?.maxDelayMs ?? 30000;
        this.jitterMs = options?.jitterMs ?? 1000;
    }

    isRateLimited(res: any): boolean {
        return isRateLimited(res);
    }

    calculateBackoff(retryCount: number): number {
        return calculateBackoff(retryCount, {
            initialDelayMs: this.initialDelayMs,
            maxDelayMs: this.maxDelayMs,
            jitterMs: this.jitterMs
        });
    }

    recordRateLimit(delayMs: number): void {
        this.rateLimitCooldownUntil = Date.now() + delayMs;
    }

    async waitForCooldown(abortSignal?: AbortSignal | null): Promise<boolean> {
        if (this.rateLimitCooldownUntil && Date.now() < this.rateLimitCooldownUntil) {
            const waitMs = Math.max(0, this.rateLimitCooldownUntil - Date.now());
            if (waitMs > 0) {
                await new Promise(r => setTimeout(r, waitMs));
                if (abortSignal && abortSignal.aborted) return false;
            }
        }
        return true;
    }

    reset(): void {
        this.rateLimitCooldownUntil = 0;
    }
}

declare global {
    var RateLimitManager: any;
    var RateLimitModule: RateLimitModule;
}

export const rateLimitModule: RateLimitModule = {
    RateLimitManager,
    isRateLimited,
    calculateBackoff
};

(rateLimitModule as any).RateLimitManager = RateLimitManager;
(rateLimitModule as any).RateLimitModule = rateLimitModule;
(rateLimitModule as any).default = rateLimitModule;

if (typeof globalThis !== 'undefined') {
    (globalThis as any).RateLimitManager = RateLimitManager;
    (globalThis as any).RateLimitModule = rateLimitModule;
}
if (typeof module === 'object' && module.exports) {
    module.exports = rateLimitModule;
}

export default rateLimitModule;
