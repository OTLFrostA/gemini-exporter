import { OperationError } from '../../../shared/errors/operationError.js';
import { isRecord } from '../../../shared/utils/typeGuards.js';
import { validateZipEntries, validateZipFile } from '../../parsers/shared/archive/zipBombGuard.js';

export type RawZipSource = Blob | Uint8Array | ArrayBuffer;

export async function loadGlobalJsZip(bytes: RawZipSource): Promise<unknown> {
    const loader: unknown = Reflect.get(globalThis, 'JSZip');
    if ((!isRecord(loader) && typeof loader !== 'function') || !('loadAsync' in loader) || typeof loader.loadAsync !== 'function') {
        throw new OperationError('ARCHIVE_READER_UNAVAILABLE', 'ZIP reader unavailable; cannot parse the archive.');
    }
    const raw: unknown = await Reflect.apply(loader.loadAsync, loader, [bytes]);
    return raw;
}

/** Validate outer ZIP size/magic (unless an already-inflated test inventory is passed),
 * inflate inventory via JSZip, and enforce zip-bomb entry/total uncompressed limits before entry reads.
 */
export async function loadValidatedZipInventory(
    bytes: RawZipSource,
    options: {
        readArchive?: (bytes: RawZipSource) => Promise<unknown>;
        invalidInventoryMessage: string;
    },
): Promise<Record<string, unknown>> {
    const suppliedInventory = isRecord(bytes) && 'files' in bytes;
    if (!suppliedInventory) validateZipFile(bytes);
    const raw = suppliedInventory ? bytes : await (options.readArchive ?? loadGlobalJsZip)(bytes);
    if (!isRecord(raw) || !isRecord(raw.files)) {
        throw new TypeError(options.invalidInventoryMessage);
    }
    validateZipEntries(raw);
    return raw.files;
}
