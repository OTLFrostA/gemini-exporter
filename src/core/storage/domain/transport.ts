import { NATIVE_DETAIL_ENVELOPE_VERSION } from '../../utils/nativeDetailTransport.js';
import type { ResourceAcquisitionHint, ResourceAcquisitionHints } from '../../resources/resourceAcquisition.js';
import type { TrustedDomainStorageRecord } from './contracts.js';

export type DomainStoreCommand = 'get' | 'save' | 'resource' | 'remove' | 'backup' | 'cache';
export function needsDomainBroker(): boolean {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id && chrome.runtime.sendMessage)
        && typeof location !== 'undefined' && location.protocol !== 'chrome-extension:';
}
export type DomainStorageWireRecord = Omit<TrustedDomainStorageRecord, 'resources'> & { resources: { assetId: string; bytes: string; sourcePath?: string }[] };
export function callDomainBroker(command: 'get' | 'save', payload: unknown): Promise<DomainStorageWireRecord | null>;
export function callDomainBroker(command: DomainStoreCommand, payload: unknown): Promise<unknown>;
export async function callDomainBroker(command: DomainStoreCommand, payload: unknown): Promise<unknown> {
    const response: unknown = await chrome.runtime.sendMessage({ action: 'domainStorage', command, payload });
    if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        const error = response && typeof response === 'object' && 'error' in response ? response.error : undefined;
        throw new Error(typeof error === 'string' ? error : 'Domain storage background did not acknowledge the request');
    }
    const value = 'value' in response ? response.value : undefined;
    if (command === 'get' || command === 'save') {
        if (!('domainEnvelopeVersion' in response) || response.domainEnvelopeVersion !== NATIVE_DETAIL_ENVELOPE_VERSION) throw new TypeError('Incompatible Domain storage reply');
        if (value === null) return null;
        if (!value || typeof value !== 'object' || !('conversation' in value) || !('resources' in value) || !Array.isArray(value.resources)) throw new TypeError('Invalid Domain storage reply');
        // Current-version extension background restored this graph from storage.
        // This assertion belongs only to the authenticated transport, never disk/page input.
        return value as DomainStorageWireRecord;
    }
    return value;
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
export function encodeDomainRecord(record: TrustedDomainStorageRecord): DomainStorageWireRecord {
    return { ...record, resources: record.resources.map(r => ({ ...r, bytes: encodeBytes(r.bytes) })) };
}
export function decodeDomainRecord(value: DomainStorageWireRecord): TrustedDomainStorageRecord {
    return { ...value, resources: value.resources.map(r => {
        if (!r || typeof r.assetId !== 'string') throw new TypeError('Invalid transported resource');
        return { assetId: r.assetId, bytes: decodeBytes(r.bytes), ...(typeof r.sourcePath === 'string' ? { sourcePath: r.sourcePath } : {}) };
    }) };
}

/** Select persistable acquisition context from a Broker envelope without casting a native result. */
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
