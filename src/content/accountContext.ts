import { readAccountFact, readAccountObservation, type AccountObservation } from '../core/domain/accountRegistry.js';
import { geminiAccountObservation } from '../core/provider/gemini/accountObservation.js';
import { detectSlotFromUrl } from '../core/utils/pathUtils.js';
import { sniffUserProfileFromDom } from './accountSniffer.js';

export interface AccountContext { readonly providerId: string; readonly accountId: string; readonly slot: string }
let binding: { context: AccountContext; identityKey: string | null } | null = null;
let generation = 0;
const slotNow = () => detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined);
const identityNow = () => sniffUserProfileFromDom()?.identityKey ?? null;

/** Tab-local binding only. A changed visible identity/slot invalidates it immediately. */
export function getAccountContext(): AccountContext | null {
    if (binding && (binding.context.slot !== slotNow() || binding.identityKey !== identityNow())) {
        binding = null; generation++;
    }
    return binding ? { ...binding.context } : null;
}

/** Resolve captured Provider evidence through the extension-origin Registry, never through a slot fallback. */
export async function resolveCurrentAccount(observed?: AccountObservation, capturedSlot = slotNow()): Promise<AccountContext | null> {
    if (capturedSlot !== slotNow()) return null;
    const raw = observed ?? geminiAccountObservation(sniffUserProfileFromDom());
    const current = getAccountContext();
    if (!raw) return current;
    const observation = readAccountObservation(raw);
    if (observation.providerId !== 'gemini') throw new TypeError('Wrong account observation provider');
    const identityKey = identityNow(), slot = slotNow();
    if (slot !== capturedSlot) return null;
    const visibleEmail = sniffUserProfileFromDom()?.email;
    if (observation.email && visibleEmail && observation.email !== visibleEmail) return null;
    // Clear the old binding before awaiting storage; delayed replies cannot resurrect a previous account.
    const ticket = ++generation;
    binding = null;
    const response: unknown = await chrome.runtime.sendMessage({ action: 'accountRegistry', command: 'observe', observation });
    if (ticket !== generation || capturedSlot !== slotNow() || identityKey !== identityNow()) return null;
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true || !('value' in response)) {
        throw new Error('Account registry did not acknowledge the observation');
    }
    const receipt = response.value;
    if (!receipt || typeof receipt !== 'object' || !('resolution' in receipt)) throw new TypeError('Invalid account registry reply');
    if ((receipt.resolution !== 'existing' && receipt.resolution !== 'created') || !('account' in receipt)) throw new TypeError('Invalid account registry receipt');
    const account = readAccountFact(receipt.account);
    if (account.providerId !== observation.providerId || account.providerAccountId !== observation.providerAccountId) throw new TypeError('Account registry identity mismatch');
    const context = { providerId: account.providerId, accountId: account.id, slot };
    binding = { context, identityKey };
    return { ...context };
}
