import type { Account } from '../../../l2/accountRegistry.js';
import { expectRecord, isUuid } from '../../../shared/utils/typeGuards.js';
import { parseEpochOrIsoTimestamp } from '../shared/time.js';

export function grokObject(value: unknown): Record<string, unknown> {
    return expectRecord(value, 'Invalid Grok source record');
}

export const grokUuid = isUuid;

export function grokTimestamp(value: unknown): number | undefined {
    return parseEpochOrIsoTimestamp(value, { allowNumeric: false });
}

export function grokAccount(raw: unknown): Omit<Account, 'id'> {
    const user = grokObject(raw);
    if (!grokUuid(user.userId)) throw new TypeError('Grok user identity unavailable');
    const name = [user.givenName, user.familyName].filter(v => typeof v === 'string').join(' ').trim();
    const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    return { providerId: 'grok', providerAccountId: user.userId,
        ...(email ? { email } : {}),
        ...(name ? { displayName: name } : {}) };
}
