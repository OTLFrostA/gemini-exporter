import { getAccount } from '../../api/accountRegistry.js';
import { attemptResource, missingResource, resourceDiagnostics, type ResourceResult, type ResourceDelivery } from '../../resources/resourceResult.js';
import { ingestDetail } from '../../domain/ingestion.js';
import * as ZipBombGuard from '../../parsers/shared/archive/zipBombGuard.js';
import { MediaIndex, readTakeoutBytes, type TakeoutStore } from '../../resources/takeout/mediaIndex.js';
import { stripHtmlTags } from '../../parsers/gemini/takeout/decodeHtml.js';
import { parseGeminiTakeoutZipArchive, type GeminiTakeoutZipRaw } from './readArchive.js';
import { TakeoutParseError } from '../../../types/errors.js';

export interface TakeoutParseResult { imported: number; status: 'ok' | 'partial' }
export { stripHtmlTags };

/** UI/acquisition adapter: native parsing precedes the one-way storage projection. */
export async function importTakeout(file: File, slot: string, onProgress?: (pct: number) => void): Promise<TakeoutParseResult> {
    if (!slot) throw new TypeError('Takeout requires an account UUID');
    const account = await getAccount(slot);
    if (!account || account.providerId !== 'gemini') throw new TypeError('Takeout requires an existing Gemini account');
    onProgress?.(15);
    ZipBombGuard.validateZipFile(file);
    let inventory: Record<string, unknown> = {};
    const suppliedArchive = file !== null && typeof file === 'object' && 'files' in file;
    const bytes = suppliedArchive ? new Uint8Array() : file as GeminiTakeoutZipRaw;
    const loader: unknown = (globalThis as { JSZip?: unknown }).JSZip;
    const readArchive = async (): Promise<unknown> => {
        if (suppliedArchive) return file;
        if (!loader || (typeof loader !== 'object' && typeof loader !== 'function') || typeof (loader as { loadAsync?: unknown }).loadAsync !== 'function') throw new TypeError('JSZip 库未加载，无法解析 ZIP');
        return (loader as { loadAsync: (raw: GeminiTakeoutZipRaw) => Promise<unknown> }).loadAsync(bytes);
    };
    const results = await parseGeminiTakeoutZipArchive(bytes, { account, providerId: 'gemini', onProgress: (completed, total) => onProgress?.(70 + Math.floor(completed / total * 18)), readArchive: async () => {
        const archive = await readArchive();
        ZipBombGuard.validateZipEntries(archive);
        if (archive && typeof archive === 'object' && 'files' in archive && archive.files && typeof archive.files === 'object') inventory = archive.files as Record<string, unknown>;
        onProgress?.(40);
        onProgress?.(70);
        return archive;
    } }).catch((error: unknown) => {
        if (error instanceof TakeoutParseError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('no recognized conversation identities') || message.includes('Unsupported Takeout')) throw new TakeoutParseError('Unsupported Takeout structure', true, 'MyActivity.html');
        throw new TakeoutParseError(message, false);
    });
    const store: TakeoutStore = { convCache: {}, mediaMap: {}, globalMedia: {} };
    const importedIds = new Set(results.map(result => result.conversationId));
    const resourceResults: ResourceResult<ResourceDelivery>[] = [];
    const basenames = new Map<string, unknown[]>();
    for (const [path, entry] of Object.entries(inventory)) {
        if (!entry || typeof entry !== 'object' || ('dir' in entry && entry.dir)) continue;
        store.globalMedia[path] = entry;
        const basename = path.split('/').pop()!;
        basenames.set(basename, [...(basenames.get(basename) ?? []), entry]);
    }
    for (const [name, entries] of basenames) if (entries.length === 1) store.globalMedia[name] = entries[0] as TakeoutStore['globalMedia'][string];
    for (const [resultIndex, result] of results.entries()) {
        const id = result.conversationId;
        const acquiredPaths: { assetId: string; path: string }[] = [];
        const native = { conversationId: id, ...(result.sourceVersion !== undefined ? { sourceVersion: result.sourceVersion } : {}), conversation: result.conversation, diagnostics: result.diagnostics, acquisitionHints: result.acquisitionHints,
            resourceHints: {} as Record<string, { archivePath: string }> };
        store.convCache[id] = native;
        // Only source-bound resources are available to native consumers. An unresolved
        // or ambiguous reference cannot fall through to a second filename heuristic.
        for (const [assetId, bound] of Object.entries(result.archiveResources)) {
            const acquired = await attemptResource(assetId, async () => {
                const bytes = await readTakeoutBytes(bound.entry);
                if (!bytes?.byteLength) throw new Error(`Takeout resource is empty or unreadable: ${bound.path}`);
                return bytes;
            });
            if (!acquired.ok) {
                resourceResults.push(acquired);
                native.diagnostics = [...native.diagnostics, ...resourceDiagnostics([acquired])];
                continue;
            }
            acquiredPaths.push({ assetId, path: bound.path });
        }
        const index = native.conversation.index;
        await ingestDetail(slot, id, native.conversation.detail, index);
        // Retain archive handles for this import only; bytes never enter Detail.
        for (const resource of acquiredPaths) {
            const path = resource.path;
            resourceResults.push({ ok: true, resourceId: resource.assetId, value: { path } });
            native.resourceHints[resource.assetId] = { archivePath: path };
            const bound = result.archiveResources[resource.assetId];
            store.globalMedia[path] = bound.entry;
            (store.mediaMap[id] ??= []).push({ filename: path, fileObj: bound.entry });
        }
        for (const asset of native.conversation.detail.assets) {
            if (!result.archiveResources[asset.id] && ![asset.sourceUri, result.acquisitionHints[asset.id]?.url, result.acquisitionHints[asset.id]?.sourceUrl].some(uri => /^(?:https?:\/\/|\/\/|data:)/i.test(uri ?? ''))) resourceResults.push(missingResource(asset.id, 'Archive resource is missing or ambiguous'));
        }
        if ((resultIndex + 1) % 50 === 0) await new Promise<void>(resume => setTimeout(resume, 0));
    }
    MediaIndex.commitTakeoutData(slot, store);
    onProgress?.(100);
    return { imported: importedIds.size, status: resourceResults.some(result => !result.ok)
        || results.some(result => result.conversation.detail.quality.status !== 'complete') ? 'partial' : 'ok' };
}
