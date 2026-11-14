import { OperationError } from '../../../shared/errors/operationError.js';
import { isRecord } from '../../../shared/utils/typeGuards.js';
import { loadValidatedZipInventory } from '../shared/zipArchive.js';

export interface OpenAIArchiveEntry {
    path: string;
    size: number;
    text(): Promise<string>;
    bytes(): Promise<Uint8Array>;
}
export interface OpenAIArchive {
    entries: ReadonlyMap<string, OpenAIArchiveEntry>;
    json(path: string): Promise<unknown>;
    logicalPaths(name: string): string[];
}

/** JSZip is a bundled global. Validate its inventory before inflating any entry. */
export async function readOpenAIArchive(file: Blob | Uint8Array): Promise<OpenAIArchive> {
    const files = await loadValidatedZipInventory(file, {
        invalidInventoryMessage: 'Invalid OpenAI ZIP inventory',
    });
    const entries = new Map<string, OpenAIArchiveEntry>();
    for (const [path, value] of Object.entries(files)) {
        if (!isRecord(value) || value.dir) continue;
        const data = value._data;
        if (!isRecord(data) || typeof data.uncompressedSize !== 'number' || data.uncompressedSize < 0 || typeof value.async !== 'function')
            throw new TypeError('Invalid OpenAI ZIP entry');
        const originalPath = typeof value.unsafeOriginalName === 'string' ? value.unsafeOriginalName : path;
        if (originalPath !== path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) throw new TypeError('Invalid OpenAI ZIP path');
        const read = value.async;
        entries.set(path, { path, size: data.uncompressedSize,
            text: async () => {
                const text: unknown = await Reflect.apply(read, value, ['string']);
                if (typeof text !== 'string') throw new TypeError('Invalid OpenAI ZIP text');
                return text;
            },
            bytes: async () => {
                const bytes: unknown = await Reflect.apply(read, value, ['uint8array']);
                if (!(bytes instanceof Uint8Array)) throw new TypeError('Invalid OpenAI ZIP bytes');
                return bytes;
            },
        });
    }
    const json = async (path: string): Promise<unknown> => {
        const entry = entries.get(path);
        if (!entry) throw new Error('OpenAI ZIP is missing a required file');
        if (entry.size > 250 * 1024 * 1024) throw new Error('OpenAI JSON exceeds the supported size limit');
        return JSON.parse(await entry.text());
    };
    const logical = new Map<string, string[]>();
    if (entries.has('export_manifest.json')) {
        const manifest = await json('export_manifest.json');
        if (!isRecord(manifest) || manifest.version !== 1 || !isRecord(manifest.logical_files))
            throw new OperationError('ARCHIVE_MANIFEST_UNSUPPORTED', 'Unsupported OpenAI export manifest');
        for (const [name, value] of Object.entries(manifest.logical_files)) {
            if (!isRecord(value) || !Array.isArray(value.files) || !value.files.length
                || !value.files.every((path): path is string => typeof path === 'string' && entries.has(path)))
                throw new OperationError('ARCHIVE_MANIFEST_MISSING_FILES', 'OpenAI export manifest references missing files');
            logical.set(name, value.files);
        }
    }
    return { entries, json, logicalPaths: name => logical.get(name) ?? (entries.has(name) ? [name] : []) };
}
