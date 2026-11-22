import { registerCleanup } from './cleanupRegistry.js';
import { getOrCreateContentAccount } from '../api/contentAccountRegistry.js';
import { readAccountParameters, DEFAULT_ACCOUNT_KEY, type Account } from '../../l2/accountRegistry.js';
import { platformForPageUrl, type SourcePlatform } from '../../shared/platformHosts.js';

export interface AccountContext { readonly providerId: string; readonly accountId: string; readonly slot: string }

export interface PlatformAccountAdapter {
    readonly providerId: SourcePlatform;
    currentSlot(): string;
    observeAccount(slot: string): Promise<Omit<Account, 'id'> | null>;
}

let adapter: PlatformAccountAdapter | null = null;

export function configureAccountAdapter(value: PlatformAccountAdapter | null): void {
    adapter = value;
}

let binding: { context: AccountContext; providerAccountId: string } | null = null;
let generation = 0;
let onAccountChanged: (() => void) | undefined;
/** Runtime wires its existing identity completion directly to the Badge. */
export function setAccountChangedHandler(handler: () => void): void {
    onAccountChanged = handler;
    registerCleanup(() => { onAccountChanged = undefined; });
}
let latestSignature: string | null = null;
let pending: { signature: string; result: Promise<AccountContext | null> } | null = null;
const providerNow = () => {
    if (adapter) return adapter.providerId;
    if (typeof location === 'undefined') return 'gemini';
    if (location.href) return platformForPageUrl(location.href) ?? 'gemini';
    const host = location.hostname;
    return host === 'grok.com' ? 'grok'
        : host === 'chatgpt.com' || host === 'chat.openai.com' ? 'chatgpt'
        : host === 'claude.ai' ? 'claude' : 'gemini';
};
const fallbackSlotFromLocation = (): string => {
    if (typeof location === 'undefined') return 'u0';
    const raw = location.href || location.pathname || '';
    const match = /\/u\/(\d+)(?:\/|$|\?|#)/.exec(raw);
    return match ? `u${match[1]}` : 'u0';
};
const slotNow = () => adapter ? adapter.currentSlot() : fallbackSlotFromLocation();

export function invalidateAccountContext(): void {
    binding = null;
    latestSignature = null;
    pending = null;
    generation++;
}

/** Cached tab-local binding. Public queries refresh MAIN-world evidence first. */
export function getAccountContext(): AccountContext | null {
    if (binding && binding.context.slot !== slotNow()) invalidateAccountContext();
    return binding ? { ...binding.context } : null;
}

export function matchesCurrentAccount(observation: Omit<Account, 'id'>): boolean {
    return getAccountContext() !== null && binding?.context.providerId === observation.providerId
        && binding.providerAccountId === observation.providerAccountId;
}

/** The isolated world cannot infer the current Gaia from arbitrary DOM emails. */
function requestObservation(slot: string): Promise<Omit<Account, 'id'> | null> {
    if (adapter) return adapter.observeAccount(slot);
    return Promise.resolve(null);
}

/** Resolve stable Provider evidence; email only updates the profile, never the binding identity. */
export async function resolveCurrentAccount(observed?: Omit<Account, 'id'> | null, capturedSlot = slotNow()): Promise<AccountContext | null> {
    if (capturedSlot !== slotNow()) return null;
    if (observed === undefined) {
        const before = generation;
        const fresh = await requestObservation(capturedSlot);
        if (capturedSlot !== slotNow()) return null;
        // A newer unsolicited observation supersedes this query's reply.
        if (before !== generation) return pending ? pending.result : getAccountContext();
        return resolveCurrentAccount(fresh, capturedSlot);
    }
    // Read-only page/Badge/Popup discovery must not allocate a placeholder.
    if (observed === null) {
        const changed = binding !== null;
        invalidateAccountContext();
        if (changed) onAccountChanged?.();
        return null;
    }
    const observation = readAccountParameters(observed);
    if (observation.providerId !== providerNow()) throw new TypeError('Wrong account observation provider');
    const current = getAccountContext();
    const signature = JSON.stringify([capturedSlot, observation]);
    if (pending?.signature === signature) return pending.result;
    if (current && latestSignature === signature) return current;
    if (!binding || binding.providerAccountId !== observation.providerAccountId) binding = null;
    const ticket = ++generation;
    const result = (async () => {
        const account = await getOrCreateContentAccount(observation.providerId, observation.providerAccountId,
            observation.email, observation.displayName);
        if (ticket !== generation || capturedSlot !== slotNow()) return null;
        const context = { providerId: account.providerId, accountId: account.id, slot: capturedSlot };
        const changed = binding?.context.accountId !== account.id;
        binding = { context, providerAccountId: account.providerAccountId };
        latestSignature = signature;
        if (changed) onAccountChanged?.();
        return { ...context };
    })();
    pending = { signature, result };
    try { return await result; }
    finally { if (pending?.result === result) pending = null; }
}

/** The captured request owns its response, even after the tab has switched account. */
export async function resolveRequestAccount(value: unknown, slot: string): Promise<AccountContext | null> {
    // Missing capture is a protocol error; explicit null means captured unknown identity.
    if (value === undefined || !/^u\d+$/.test(slot)) return null;
    const parameters = value === null ? { providerId: 'gemini', providerAccountId: DEFAULT_ACCOUNT_KEY }
        : readAccountParameters(value);
    if (parameters.providerId !== 'gemini') throw new TypeError('Wrong request account provider');
    // Captured profile hints may predate a newer live observation of this same subject.
    // Resolve request ownership only; current-page discovery owns profile updates.
    const account = await getOrCreateContentAccount(parameters.providerId, parameters.providerAccountId);
    return { providerId: account.providerId, accountId: account.id, slot };
}

/** Synchronous commit guard after the asynchronous source/Registry resolution. */
export function isCurrentAccount(context: AccountContext): boolean {
    const current = getAccountContext();
    return current?.accountId === context.accountId && current.providerId === context.providerId && current.slot === context.slot;
}
