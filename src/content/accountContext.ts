import { readAccountFact, readAccountObservation, type AccountObservation } from '../core/domain/accountRegistry.js';
import { CrossWorldEvents } from '../core/protocol/protocol.js';
import { detectSlotFromUrl } from '../core/utils/pathUtils.js';

export interface AccountContext { readonly providerId: string; readonly accountId: string; readonly slot: string }
let binding: { context: AccountContext; providerAccountId: string } | null = null;
let generation = 0;
let latestSignature: string | null = null;
let pending: { signature: string; result: Promise<AccountContext | null> } | null = null;
const slotNow = () => detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined);

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

export function matchesCurrentAccount(observation: AccountObservation): boolean {
    return getAccountContext() !== null && binding?.context.providerId === observation.providerId
        && binding.providerAccountId === observation.providerAccountId;
}

/** The isolated world cannot infer the current Gaia from arbitrary DOM emails. */
function requestObservation(slot: string): Promise<AccountObservation | null> {
    if (typeof window === 'undefined') return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const finish = (observation: AccountObservation | null, error?: unknown): void => {
            clearTimeout(timer);
            window.removeEventListener('message', receive);
            if (error) reject(error); else resolve(observation);
        };
        const receive = (event: MessageEvent): void => {
            if (event.source !== window || event.origin !== location.origin
                || event.data?.type !== CrossWorldEvents.ACCOUNT_OBSERVED) return;
            const payload = event.data.payload;
            if (payload?.requestId !== requestId || payload.slot !== slot) return;
            try { finish(payload.observation === null ? null : readAccountObservation(payload.observation)); }
            catch (error) { finish(null, error); }
        };
        const timer = setTimeout(() => finish(null), 2000);
        window.addEventListener('message', receive);
        window.postMessage({ type: CrossWorldEvents.ACCOUNT_REQUESTED, payload: { requestId } }, location.origin);
    });
}

/** Resolve stable Provider evidence; email only updates the profile, never the binding identity. */
export async function resolveCurrentAccount(observed?: AccountObservation | null, capturedSlot = slotNow()): Promise<AccountContext | null> {
    if (capturedSlot !== slotNow()) return null;
    if (observed === undefined) {
        const before = generation;
        const fresh = await requestObservation(capturedSlot);
        if (capturedSlot !== slotNow()) return null;
        // A newer unsolicited observation supersedes this query's reply.
        if (before !== generation) return getAccountContext();
        return resolveCurrentAccount(fresh, capturedSlot);
    }
    if (observed === null) { invalidateAccountContext(); return null; }
    const observation = readAccountObservation(observed);
    if (observation.providerId !== 'gemini') throw new TypeError('Wrong account observation provider');
    const current = getAccountContext();
    const signature = JSON.stringify([capturedSlot, observation]);
    if (pending?.signature === signature) return pending.result;
    if (current && latestSignature === signature) return current;
    if (!binding || binding.providerAccountId !== observation.providerAccountId) binding = null;
    const ticket = ++generation;
    const result = (async () => {
        const response: unknown = await chrome.runtime.sendMessage({ action: 'accountRegistry', command: 'observe', observation });
        if (ticket !== generation || capturedSlot !== slotNow()) return null;
        if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true || !('value' in response)) {
            throw new Error('Account registry did not acknowledge the observation');
        }
        const receipt = response.value;
        if (!receipt || typeof receipt !== 'object' || !('resolution' in receipt)) throw new TypeError('Invalid account registry reply');
        if ((receipt.resolution !== 'existing' && receipt.resolution !== 'created') || !('account' in receipt)) throw new TypeError('Invalid account registry receipt');
        const account = readAccountFact(receipt.account);
        if (account.providerId !== observation.providerId || account.providerAccountId !== observation.providerAccountId) throw new TypeError('Account registry identity mismatch');
        const context = { providerId: account.providerId, accountId: account.id, slot: capturedSlot };
        binding = { context, providerAccountId: account.providerAccountId };
        latestSignature = signature;
        return { ...context };
    })();
    pending = { signature, result };
    try { return await result; }
    finally { if (pending?.result === result) pending = null; }
}
