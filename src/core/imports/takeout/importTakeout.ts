import type { SourceResourceContext } from '../../provider/sourceResources.js';
import { getAccount } from '../../api/accountRegistry.js';
import { ingestDetail } from '../../domain/ingestion.js';
import * as ZipBombGuard from '../../parsers/shared/archive/zipBombGuard.js';
import { stripHtmlTags } from '../../parsers/gemini/takeout/decodeHtml.js';
import { parseGeminiTakeoutZipArchive, readTakeoutBytes, type GeminiTakeoutZipRaw } from './readArchive.js';
import { TakeoutParseError } from '../../../types/errors.js';

export interface TakeoutParseResult { imported: number; status: 'ok' | 'partial' }
export { stripHtmlTags };

/** UI/acquisition adapter: native parsing precedes the one-way storage projection. */
export async function importTakeout(file: File, slot: string, onProgress?: (pct: number) => void, resources?: SourceResourceContext): Promise<TakeoutParseResult> {
    if (!slot) throw new TypeError('Takeout requires an account UUID');
    const account = await getAccount(slot);
    if (!account || account.providerId !== 'gemini') throw new TypeError('Takeout requires an existing Gemini account');
    onProgress?.(15);
    ZipBombGuard.validateZipFile(file);
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
        onProgress?.(40);
        onProgress?.(70);
        return archive;
    } }).catch((error: unknown) => {
        if (error instanceof TakeoutParseError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('no recognized conversation identities') || message.includes('Unsupported Takeout')) throw new TakeoutParseError('Unsupported Takeout structure', true, 'MyActivity.html');
        throw new TakeoutParseError(message, false);
    });
    const importedIds = new Set(results.map(result => result.conversationId));
    let resourceFailure = false;
    for (const [resultIndex, result] of results.entries()) {
        const id = result.conversationId;
        await ingestDetail(slot, id, result.conversation.detail, result.conversation.index);
        resources?.retainParsed({ accountId: slot, conversationId: id }, result);
        for (const [assetId, bound] of Object.entries(result.archiveResources)) {
            resources?.retain({ accountId: slot, conversationId: id }, assetId, async () => {
                const bytes = await readTakeoutBytes(bound.entry);
                if (!bytes?.byteLength) throw new Error('Empty Takeout resource');
                return { bytes };
            });
        }
        for (const asset of result.conversation.detail.assets) {
            if (!result.archiveResources[asset.id] && ![asset.sourceUri, result.acquisitionHints[asset.id]?.url, result.acquisitionHints[asset.id]?.sourceUrl].some(uri => /^(?:https?:\/\/|\/\/|data:)/i.test(uri ?? ''))
                && !result.acquisitionHints[asset.id]?.dataBase64) resourceFailure = true;
        }
        if ((resultIndex + 1) % 50 === 0) await new Promise<void>(resume => setTimeout(resume, 0));
    }
    onProgress?.(100);
    return { imported: importedIds.size, status: resourceFailure
        || results.some(result => result.conversation.detail.quality.status !== 'complete') ? 'partial' : 'ok' };
}
