import { getAccount } from '../../api/accountRegistry.js';
import { attemptResource, missingResource, resourceDiagnostics, type ResourceResult, type ResourceDelivery } from '../../resources/resourceResult.js';
import { getConversations } from '../../storage/storageService.js';
import { ingestConversation } from '../../storage/conversationIngest.js';
import type { StoredDomainResource } from '../../storage/domain/contracts.js';
import { ZipBombGuard } from './zipBombGuard.js';
import { I18n } from '../../utils/i18n.js';
import { __resolveModule } from '../../utils/moduleOverrides.js';
import { MediaIndex, readTakeoutBytes, type TakeoutStore } from '../../resources/takeout/mediaIndex.js';
import { stripHtmlTags } from '../../parsers/gemini/takeout/decodeHtml.js';
import { parseGeminiTakeoutZipArchive, type GeminiTakeoutZipRaw } from '../../parsers/gemini/takeout/parseZip.js';
import { TakeoutParseError } from '../../../types/errors.js';
import type { DomainConversationIndex } from '../../../types/index.js';
import type { Diagnostic } from '../../diagnostics/diagnostic.js';

export interface TakeoutParseResult extends TakeoutStore {
    conversations: DomainConversationIndex[];
    totalMediaCount: number;
    diagnostics: Diagnostic[];
    resourceResults: ResourceResult<ResourceDelivery>[];
    status: 'ok' | 'partial';
}
export { stripHtmlTags };

/** UI/acquisition adapter: native parsing precedes the one-way storage projection. */
export async function parseTakeoutZip(file: unknown, onProgress?: ((pct: number, msg: string) => void) | null, slot: string | null = null): Promise<TakeoutParseResult> {
    if (!slot) throw new TypeError('Takeout requires an account UUID');
    const account = await getAccount(slot);
    if (!account || account.providerId !== 'gemini') throw new TypeError('Takeout requires an existing Gemini account');
    const i18n = __resolveModule('I18n', I18n);
    onProgress?.(15, i18n.t('takeoutUnzipping'));
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
    const results = await parseGeminiTakeoutZipArchive(bytes, { account, providerId: 'gemini', onProgress: (completed, total) => onProgress?.(70 + Math.floor(completed / total * 18), i18n.t('takeoutParsingDetailProgress', completed, total)), readArchive: async () => {
        const archive = await readArchive();
        ZipBombGuard.validateZipEntries(archive);
        if (archive && typeof archive === 'object' && 'files' in archive && archive.files && typeof archive.files === 'object') inventory = archive.files as Record<string, unknown>;
        onProgress?.(40, i18n.t('takeoutParsingStructure'));
        onProgress?.(70, i18n.t('takeoutParsingDetail'));
        return archive;
    } }).catch((error: unknown) => {
        if (error instanceof TakeoutParseError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('no recognized conversation identities') || message.includes('Unsupported Takeout')) throw new TakeoutParseError(i18n.t('takeoutFormatChanged'), true, 'MyActivity.html');
        throw new TakeoutParseError(message, false);
    });
    const store: TakeoutStore = { convCache: {}, mediaMap: {}, globalMedia: {} };
    const importedIds = new Set(results.map(result => result.conversation.index.key.conversationId));
    const resourceResults: ResourceResult<ResourceDelivery>[] = [];
    const diagnostics: Diagnostic[] = [];
    const basenames = new Map<string, unknown[]>();
    for (const [path, entry] of Object.entries(inventory)) {
        if (!entry || typeof entry !== 'object' || ('dir' in entry && entry.dir)) continue;
        store.globalMedia[path] = entry;
        const basename = path.split('/').pop()!;
        basenames.set(basename, [...(basenames.get(basename) ?? []), entry]);
    }
    for (const [name, entries] of basenames) if (entries.length === 1) store.globalMedia[name] = entries[0] as TakeoutStore['globalMedia'][string];
    for (const [resultIndex, result] of results.entries()) {
        const id = result.conversation.index.key.conversationId;
        const durableResources: StoredDomainResource[] = [];
        const native = { account, ...(result.sourceVersion !== undefined ? { sourceVersion: result.sourceVersion } : {}), conversation: result.conversation, diagnostics: result.diagnostics, acquisitionHints: result.acquisitionHints,
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
            durableResources.push({ assetId, bytes: acquired.value, sourcePath: bound.path });
        }
        Object.assign(native, await ingestConversation(slot, native, durableResources, 'takeout'));
        // The repository write is the delivery boundary; it stays fatal if the store itself fails.
        for (const resource of durableResources) {
            const path = resource.sourcePath!;
            resourceResults.push({ ok: true, resourceId: resource.assetId, value: { path } });
            native.resourceHints[resource.assetId] = { archivePath: path };
            const bound = result.archiveResources[resource.assetId];
            store.globalMedia[path] = bound.entry;
            (store.mediaMap[id] ??= []).push({ filename: path, fileObj: bound.entry });
        }
        for (const asset of native.conversation.detail.assets) {
            if (!result.archiveResources[asset.id] && ![asset.sourceUri, result.acquisitionHints[asset.id]?.url, result.acquisitionHints[asset.id]?.sourceUrl].some(uri => /^(?:https?:\/\/|\/\/|data:)/i.test(uri ?? ''))) resourceResults.push(missingResource(asset.id, 'Archive resource is missing or ambiguous'));
        }
        diagnostics.push(...native.diagnostics);
        if ((resultIndex + 1) % 50 === 0) await new Promise<void>(resume => setTimeout(resume, 0));
    }
    const conversations = (await getConversations(slot)).filter(row => importedIds.has(row.key.conversationId));
    const totalMediaCount = Object.entries(inventory).filter(([path, entry]) => entry && typeof entry === 'object' && !('dir' in entry && entry.dir) && !/\.(html|json)$/i.test(path)).length;
    MediaIndex.commitTakeoutData(slot, store);
    onProgress?.(100, i18n.t('takeoutSuccessSummary', conversations.length, totalMediaCount));
    return { ...store, conversations, totalMediaCount, resourceResults, status: resourceResults.some(result => !result.ok) ? 'partial' : 'ok',
        diagnostics: [...diagnostics, ...resourceDiagnostics(resourceResults).filter(d => !diagnostics.some(existing => existing.path === d.path && existing.code === d.code))] };
}
