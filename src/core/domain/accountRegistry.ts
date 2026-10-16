/** Stable local identity. Provider subjects are evidence; session slots never enter this model. */
export interface AccountFact {
    id: string;
    providerId: string;
    /** Deterministic Provider identity key: a subject or a canonical tuple, interpreted by its adapter. */
    providerAccountId: string;
    email?: string;
    displayName?: string;
}
export type AccountObservation = Omit<AccountFact, 'id'>;
export type AccountResolution =
    | { resolution: 'existing'; account: AccountFact }
    | { resolution: 'create'; observation: AccountObservation };

const fields = ['providerId', 'providerAccountId', 'email', 'displayName'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isAccountId(value: unknown): value is string {
    return typeof value === 'string' && uuid.test(value);
}
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid account fact');
    return value as Record<string, unknown>;
}
/** Boundary validation only; normalization belongs to the Provider adapter. */
export function readAccountObservation(value: unknown): AccountObservation {
    const raw = object(value);
    if (Object.keys(raw).some(key => !fields.includes(key)) || typeof raw.providerId !== 'string' || !raw.providerId
        || typeof raw.providerAccountId !== 'string' || !raw.providerAccountId
        || fields.some(key => raw[key] !== undefined && (typeof raw[key] !== 'string' || !raw[key] || raw[key] !== raw[key].trim()))) {
        throw new TypeError('Invalid account observation');
    }
    return { providerId: raw.providerId, providerAccountId: raw.providerAccountId,
        ...(typeof raw.email === 'string' ? { email: raw.email } : {}),
        ...(typeof raw.displayName === 'string' ? { displayName: raw.displayName } : {}) };
}
export function readAccountFact(value: unknown): AccountFact {
    const { id, ...observation } = object(value);
    if (!isAccountId(id)) throw new TypeError('Invalid local account UUID');
    return { id, ...readAccountObservation(observation) };
}
export function readAccountRegistry(value: unknown): AccountFact[] {
    if (!Array.isArray(value)) throw new TypeError('Invalid account registry');
    const accounts = value.map(readAccountFact);
    const ids = new Set<string>(), subjects = new Set<string>();
    for (const account of accounts) {
        const subject = JSON.stringify([account.providerId, account.providerAccountId]);
        if (ids.has(account.id) || account.providerAccountId && subjects.has(subject)) throw new TypeError('Duplicate account identity');
        ids.add(account.id);
        if (account.providerAccountId) subjects.add(subject);
    }
    return accounts;
}
/** Pure matching of normalized, valid identity facts. Email never participates. */
export function resolveAccount(accounts: readonly AccountFact[], observation: AccountObservation): AccountResolution {
    const matches = accounts.filter(account => account.providerId === observation.providerId
        && account.providerAccountId === observation.providerAccountId);
    if (matches.length > 1) throw new TypeError('Duplicate account identity');
    if (!matches.length) return { resolution: 'create', observation: { ...observation } };
    return { resolution: 'existing', account: { ...matches[0], ...observation, id: matches[0].id } };
}
