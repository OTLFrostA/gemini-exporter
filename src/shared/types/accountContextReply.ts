import { isRecord } from '../utils/typeGuards.js';

export interface BoundTabAccountContext {
    readonly accountId: string;
    readonly providerId: string;
    readonly slot?: string;
}

export type AccountContextReplyOutcome =
    | { readonly ok: true; readonly accountContext: BoundTabAccountContext | null; readonly conversationId: string | null }
    | { readonly ok: false; readonly error?: string };

/** Decode a Content `{ action: 'getAccountContext' }` IPC reply at a single shared boundary. */
export function readAccountContextReply(response: unknown): AccountContextReplyOutcome {
    if (!isRecord(response) || response.ok !== true || !('accountContext' in response)) {
        const error = isRecord(response) && 'error' in response && response.error !== undefined
            ? String(response.error) : undefined;
        return { ok: false, ...(error !== undefined ? { error } : {}) };
    }
    const rawContext = response.accountContext;
    const conversationId = typeof response.conversationId === 'string' ? response.conversationId : null;
    if (rawContext === null) {
        return { ok: true, accountContext: null, conversationId };
    }
    if (!isRecord(rawContext) || typeof rawContext.accountId !== 'string' || typeof rawContext.providerId !== 'string') {
        return { ok: false };
    }
    return {
        ok: true,
        accountContext: {
            accountId: rawContext.accountId,
            providerId: rawContext.providerId,
            ...(typeof rawContext.slot === 'string' ? { slot: rawContext.slot } : {}),
        },
        conversationId,
    };
}

export function readBoundAccountContext(response: unknown, expectedProviderId?: string): BoundTabAccountContext | null {
    const parsed = readAccountContextReply(response);
    if (!parsed.ok || !parsed.accountContext) return null;
    if (expectedProviderId !== undefined && parsed.accountContext.providerId !== expectedProviderId) return null;
    return parsed.accountContext;
}
