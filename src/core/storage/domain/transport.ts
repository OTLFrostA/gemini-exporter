import type { DomainStorageRecord } from './contracts.js';

export type DomainStoreCommand = 'get' | 'save' | 'resource' | 'remove' | 'backup' | 'cache';
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
export function encodeDomainRecord(record: DomainStorageRecord): unknown {
    return { ...record, resources: record.resources.map(r => ({ ...r, bytes: encodeBytes(r.bytes) })) };
}
export function decodeDomainRecord(value: unknown): DomainStorageRecord {
    if (!value || typeof value !== 'object' || !('resources' in value) || !Array.isArray(value.resources)) throw new TypeError('Invalid transported Domain record');
    return { ...value, resources: value.resources.map((r: unknown) => {
        if (!r || typeof r !== 'object' || !('assetId' in r) || typeof r.assetId !== 'string' || !('bytes' in r)) throw new TypeError('Invalid transported resource');
        return { assetId: r.assetId, bytes: decodeBytes(r.bytes), ...('sourcePath' in r && typeof r.sourcePath === 'string' ? { sourcePath: r.sourcePath } : {}) };
    }) } as DomainStorageRecord;
}
