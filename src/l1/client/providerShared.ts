import { OperationError } from '../../shared/errors/operationError.js';
import type { Diagnostic } from '../../shared/diagnostics/diagnostic.js';
import type { Account } from '../../l2/accountRegistry.js';
import { DEFAULT_ACCOUNT_KEY } from '../../l2/accountRegistry.js';
import { readConversationKey, type ConversationKey } from '../../l2/conversationKey.js';
import { ingestDetail } from '../../l2/ingestion.js';
import type { ProviderConversationItem } from '../parsers/contracts.js';
import type { SourceConversationParseResult } from '../parsers/parsingResult.js';
import type { SourceResourceContext } from '../resources/sourceResources.js';
import { getAccount } from '../../runtime/api/accountRegistry.js';
import { platformDisplayName, type SourcePlatform } from '../../shared/platformHosts.js';

/** Verify a local Account exists and belongs to the expected platform (with optional subject predicate). */
export async function requireProviderAccount(
    providerId: SourcePlatform,
    accountId: string,
    validSubject: (providerAccountId: string) => boolean = () => true,
): Promise<Account> {
    const account = await getAccount(accountId);
    if (!account || account.providerId !== providerId || !validSubject(account.providerAccountId)) {
        throw new OperationError('ACCOUNT_UNAVAILABLE', `Provider account mismatch: ${platformDisplayName(providerId)} account mismatch`);
    }
    return account;
}

/** Map normalized L1 list items into the canonical L2 Index ingestion batch format. */
export function toIndexIngestItems(items: readonly ProviderConversationItem[]) {
    return items.map(item => ({
        conversationId: item.id,
        fields: {
            ...(item.title ? { title: item.title, titleSource: 'provider' as const } : {}),
            ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
            ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
        },
    }));
}

/** Track monotonic descending timestamps and reject duplicate IDs across paginated list streams. */
export function createDescendingPageChain() {
    const seen = new Set<string>();
    let lastTime = Infinity;
    return {
        verifyAndAdvance(keys: ReadonlyArray<{ id: string; time: number }>): boolean {
            const ordered = keys.every((key, i) =>
                Number.isSafeInteger(key.time) && key.time > 0
                && !seen.has(key.id)
                && (i === 0 ? key.time <= lastTime : keys[i - 1].time >= key.time))
                && new Set(keys.map(key => key.id)).size === keys.length;
            if (ordered) {
                for (const key of keys) seen.add(key.id);
                if (keys.length) lastTime = keys[keys.length - 1].time;
            }
            return ordered;
        },
        hasSeen(id: string): boolean {
            return seen.has(id);
        },
    };
}

export function isIdentifiedProviderAccount(account: Account): boolean {
    return account.providerAccountId !== DEFAULT_ACCOUNT_KEY;
}

export function forwardSourceDiagnostics(
    diagnostics: readonly Diagnostic[],
    onDiagnostic?: (diagnostic: Diagnostic) => void,
): void {
    for (const diagnostic of diagnostics) {
        try { onDiagnostic?.(diagnostic); }
        catch (error) { console.warn('[Gemini Exporter] Source diagnostic listener failed', error); }
    }
}

/** Forward parser diagnostics, commit Detail + Index to L2, and retain task-scoped inline resource hints. */
export async function commitProviderDetail(options: {
    accountId: string;
    conversationId: string;
    parsed: SourceConversationParseResult;
    resources?: SourceResourceContext;
    onDiagnostic?: (diagnostic: Diagnostic) => void;
}): Promise<{ accepted: boolean; changed: boolean }> {
    forwardSourceDiagnostics(options.parsed.diagnostics, options.onDiagnostic);
    const admission = await ingestDetail(
        options.accountId,
        options.conversationId,
        options.parsed.conversation.detail,
        options.parsed.conversation.index,
    );
    if (admission.accepted) {
        options.resources?.retainParsed({ accountId: options.accountId, conversationId: options.conversationId }, options.parsed);
    }
    return admission;
}

export function assertValidResourceKey(key: ConversationKey): void {
    readConversationKey(key);
}
