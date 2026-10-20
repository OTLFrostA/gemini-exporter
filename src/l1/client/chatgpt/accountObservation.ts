import type { Account } from '../../../l2/accountRegistry.js';

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | undefined {
    return typeof value === 'string' ? value.trim() || undefined : undefined;
}

/** Session evidence only. A ChatGPT archive scope is one login subject in one workspace. */
export function chatgptAccountObservation(session: unknown): Omit<Account, 'id'> | null {
    const raw = record(session), user = record(raw?.user), workspace = record(raw?.account);
    const userId = text(user?.id), workspaceId = text(workspace?.id);
    if (!userId || !workspaceId || workspaceId === 'default') return null;
    const email = text(user?.email)?.toLowerCase(), displayName = text(user?.name);
    return {
        providerId: 'chatgpt',
        // Canonical tuple encoding avoids ambiguous concatenation; neither ID is interchangeable.
        providerAccountId: JSON.stringify([userId, workspaceId]),
        ...(email ? { email } : {}),
        ...(displayName ? { displayName } : {}),
    };
}
