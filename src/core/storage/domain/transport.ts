/** Storage broker wire version is independent of the Application detail reply. */
export const DOMAIN_STORAGE_ENVELOPE_VERSION = 3;
import type { ResourceAcquisitionHint, ResourceAcquisitionHints } from '../../resources/resourceAcquisition.js';
export type DomainStoreCommand = 'get' | 'put' | 'resource' | 'remove' | 'cache' | 'acquired' | 'hints' | 'clearResources' | 'ready';
export function needsDomainBroker(): boolean {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id && chrome.runtime.sendMessage)
        && typeof location !== 'undefined' && location.protocol !== 'chrome-extension:';
}
export async function callDomainBroker(command: DomainStoreCommand, payload: unknown): Promise<unknown> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'domainStorage', command, payload });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        const error = response && typeof response === 'object' && 'error' in response ? response.error : undefined;
        throw new Error(typeof error === 'string' ? error : 'Domain storage background did not acknowledge the request');
    }
    if (!('domainEnvelopeVersion' in response) || response.domainEnvelopeVersion !== DOMAIN_STORAGE_ENVELOPE_VERSION) throw new TypeError('Incompatible Domain storage reply');
    return 'value' in response ? response.value : undefined;
}
export function encodeBytes(bytes: Uint8Array): string {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
}
export function decodeBytes(value: unknown): Uint8Array {
    if (typeof value !== 'string') throw new TypeError('Invalid transported resource bytes');
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
/** Read temporary acquisition locators from a Broker envelope without casting a native result. */
export function readStoredAcquisitionHints(value: unknown): ResourceAcquisitionHints {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid stored acquisition context');
    const entries: [string, ResourceAcquisitionHint][] = [];
    for (const [id, raw] of Object.entries(value)) {
        const hint: unknown = raw;
        if (!hint || typeof hint !== 'object' || Array.isArray(hint)) throw new TypeError('Invalid stored acquisition context');
        const field = (key: string): unknown => Reflect.get(hint, key);
        const url = field('url'), sourceUrl = field('sourceUrl'), src = field('src'), candidates = field('candidates');
        if ([url, sourceUrl, src].some(v => v !== undefined && typeof v !== 'string')
            || (candidates !== undefined && (!Array.isArray(candidates) || !candidates.every((v: unknown): v is string => typeof v === 'string')))) {
            throw new TypeError('Invalid stored acquisition context');
        }
        entries.push([id, { ...(typeof url === 'string' ? { url } : {}), ...(typeof sourceUrl === 'string' ? { sourceUrl } : {}),
            ...(typeof src === 'string' ? { src } : {}), ...(Array.isArray(candidates) && candidates.every((v: unknown): v is string => typeof v === 'string') ? { candidates: candidates.slice() } : {}) }]);
    }
    return Object.fromEntries(entries);
}
